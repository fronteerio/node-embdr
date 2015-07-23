/**
 * Copyright (c) 2015 "Fronteer LTD". All rights reserved.
 */

'use strict';

var _ = require('lodash');
var request = require('request');
var Stream = require('stream');
var util = require('util');

module.exports = Embdr;

// Default the host settings where the Embdr API can be reached
Embdr.DEFAULT_HOST = 'embdr.io';
Embdr.DEFAULT_PORT = '80';
Embdr.DEFAULT_PROTOCOL = 'http';
Embdr.DEFAULT_STRICT_SSL = true;
Embdr.DEFAULT_BASE_PATH = '/api';

// The amount of milliseconds that should be waited before getting a resource's metadata
// when starting to poll a newly created resource
Embdr.DEFAULT_POLLING_INITIAL_TIMEOUT = 2000;

// The poller will gradually increase the time-out as it waits for pending processors to finish. It
// does this by adding a fraction of the previous polling time-out. For example, assume:
//  - an initial time-out of 2000ms
//  - a back-off denominator of 4
// The poller time-outs (in seconds) between two consecutive resource checks looks like:
// 2, 3, 3, 4, 5, 6, 8, 10, 12, 15, 19, 23, 29, 36, 45, 57, 71, 89, 111, 139, ..
Embdr.DEFAULT_POLLING_BACKOFF_DENOMINATOR = 4;

/**
 * Create a new Embdr instance
 *
 * @constructor
 * @param {string}      key     The API key that allows for uploading to the Embdr REST API
 */
function Embdr(key) {
    if (!(this instanceof Embdr)) {
        return new Embdr(key);
    }

    this._api = {
        'auth': null,
        'host': Embdr.DEFAULT_HOST,
        'port': Embdr.DEFAULT_PORT,
        'basePath': Embdr.DEFAULT_BASE_PATH,
        'protocol': Embdr.DEFAULT_PROTOCOL
    };

    this.setApiKey(key);
    this._exposeApis();
}

/**
 * Process an item
 *
 * @param  {Stream|Buffer|string}   item                                The item to process. If the `item` is a Stream or a Buffer a file will be created. If the `item` is a string and starts with `http`, a link will be created, otherwise it's assumed to be a path on disk
 * @param  {Object}                 options                             The options and callbacks
 * @param  {Function|string}        options.start                       Called when the item has been created. Its only argument is the resource that was created by the REST API. If this is a string, it's assumed it's a callback URL where the data should be posted to
 * @param  {Function|string}        options.error                       Called when the REST API could not be reached. Its only argument is the error object explaining what went wrong. If this is a string, it's assumed it's a callback URL where the data should be posted to
 * @param  {Function|string}        options.complete                    Called when the item has been fully processed and all previews have been generated. If this is a string, it's assumed it's a callback URL where the data should be posted to
 * @param  {Object}                 options.images                      The image previews
 * @param  {string[]}               options.images.sizes                The sizes for the image previews. This should be a comma-separated list of sizes of the format {width}x{height}. When one dimension is specified, the image will be scaled appropriately For example, ['1200x', 'x600']
 * @param  {Function}               options.images.complete             Called when all the image previews have been processed. If this is a string, it's assumed it's a callback URL where the data should be posted to
 * @param  {Object}                 options.thumbnails                  The thumbnail options
 * @param  {string[]}               options.thumbnails.sizes            The sizes for the thumbnails. This should be a comma-separated list of thumbnail sizes of the format {width}x{height}. For example, ['32x32', '256×256']
 * @param  {Function}               options.thumbnails.complete         Called when all the thumbnails have been processed. If this is a string, it's assumed it's a callback URL where the data should be posted to
 */
Embdr.prototype.process = function(item, options) {
    var self = this;
    options = options || {};
    options.images = options.images || {};
    options.thumbnails = options.thumbnails || {};

    var hasPollingCallbacks = (options.complete || options.images.complete || options.thumbnails.complete);

    // Default the callbacks
    options.start = options.start || function() {};
    options.error = options.error || function() {};
    options.complete = options.complete || function() {};
    options.images.complete = options.images.complete || function() {};
    options.thumbnails.complete = options.thumbnails.complete || function() {};

    // TODO: Pass along callback URLs when provided

    // Build up the set of callbacks and run each callback through `_.once`. This will ensure
    // that we don't accidentally notify the user twice
    var callbacks = {
        'start': _.once(options.start),
        'error': _.once(options.error),
        'complete': _.once(options.complete),
        'images': _.once(options.images.complete),
        'thumbnails': _.once(options.thumbnails.complete)
    };

    // Determine whether the client wants to create a file or a link. Note that a string-item
    // is only considered a link if it starts with `http`. We assume it's a path on disk otherwise
    var creator = this.resources.createFile;
    if (_.isString(item) && item.substr(0, 4) === 'http') {
        creator = this.resources.createLink;
    }

    // Create a resource for the given item
    var createOptions = {
        'thumbnailSizes': options.thumbnails.sizes,
        'imageSizes': options.images.sizes
    };
    creator(item, createOptions, function(createError, createdResource) {
        if (createError) {
            // If the Embdr API can't reach the link it might be because the link is pointing inside
            // of a private subnet which is only accessible from a DMZ or to a resource running on
            // the server itself. In those cases, we let the client request the resource and
            // upload it to the Embdr API manually
            if (createError.code === 400 && createError.message === 'Unable to handle a link because it could not be reached') {
                return self.process(request(item), options);

            // Something else went wrong, we'll need to pass this on to the caller
            } else {
                return callbacks.error(createError);
            }
        }

        // Indicate that the resource has been created and it's scheduled for processing
        callbacks.start(createdResource);

        // The REST API will let us know immediately whether it can or cannot process content. In
        // case it cannot, we can complete immediately and there's no need to do any polling
        if (createdResource.status !== 'pending') {
            return callbacks.complete(createdResource);
        }

        // If no polling callbacks were provided, we can stop here
        if (!hasPollingCallbacks) {
            return;
        }

        // Get the polling time-out, each polling run will increment the timeout
        var pollingTimeout = Embdr.DEFAULT_POLLING_INITIAL_TIMEOUT;

        // TODO: Don't poll if callback URLs are provided

        var poll = function() {
            // Get the resource's new metadata
            self.resources.get(createdResource.id, function(err, resource) {
                if (err) {
                    return callbacks.error(err);
                }

                // Check thumbnails
                var thumbnailsDone = _.chain(resource.thumbnails)
                    .filter({'status': 'pending'})
                    .isEmpty()
                    .value();
                if (thumbnailsDone) {
                    callbacks.thumbnails(resource.thumbnails);
                }

                // Check the images
                var imagesDone = _.chain(resource.images)
                    .filter({'status': 'pending'})
                    .isEmpty()
                    .value();
                if (imagesDone) {
                    callbacks.thumbnails(resource.images);
                }

                // If there are no pending processors left, we're done and can return to the caller
                if (resource.status !== 'pending') {
                    return callbacks.complete(resource);

                // Continue polling as long as there are still pending processors
                } else {
                    // Add a quarter of the polling timeout each time we check whether new updates
                    // are available. This will ensure that the interval gradually backs off.
                    pollingTimeout += Math.round(pollingTimeout / 4);
                    setTimeout(poll, pollingTimeout);
                }
            });
        };

        // Start polling the resource for state changes
        setTimeout(poll, pollingTimeout);
    });
};

/**
 * Set the details of where the REST API can be reached
 *
 * @param {string}      host            The hostname where the REST API can be reached
 * @param {number}      [port]          The port on which the REST API can be reached
 * @param {string}      [protocol]      The protocol on which the REST API can be reached
 */
Embdr.prototype.setHost = function(host, port, protocol) {
    this._setApiField('host', host);
    if (port) {
        this.setPort(port);
    }
    if (protocol) {
        this.setProtocol(protocol);
    }
};

/**
 * Set the port on which the REST API can be reached
 *
 * @param {number}      port            The port on which the REST API can be reached
 */
Embdr.prototype.setPort = function(port) {
    this._setApiField('port', port);
};

/**
 * Set the protocol on which the REST API can be reached
 *
 * @param {string}      protocol        The protocol on which the REST API can be reached
 */
Embdr.prototype.setProtocol = function(protocol) {
    this._setApiField('protocol', protocol.toLowerCase());
};

/**
 * Set the base path on which the REST API can be reached
 *
 * @param {string}      basePath        The base path on which the REST API can be reached
 */
Embdr.prototype.setBasePath = function(basePath) {
    this._setApiField('basePath', basePath.toLowerCase());
};

/**
 * Whether SSL errors should cause a request to fail
 *
 * @param {boolean}      strictSSL      Whether SSL errors should cause a request to fail
 */
Embdr.prototype.setStrictSSL = function(strictSSL) {
    this._setApiField('strictSSL', strictSSL);
};

/**
 * Set the API key that allows for uploading to the Embdr REST API
 *
 * @param {string}      key             The API key that allows for uploading to the Embdr REST API
 */
Embdr.prototype.setApiKey = function(key) {
    if (key) {
        var auth = 'Basic ' + new Buffer(key + ':').toString('base64');
        this._setApiField('auth', auth);
    }
};

/**
 * Set an API field such as `host`, `port`, etc..
 *
 * @param {string}      key             The name of the API field to set
 * @param {string}      value           The value of the api field to set
 * @api private
 */
Embdr.prototype._setApiField = function(key, value) {
    this._api[key] = value;
};

/**
 * Expose the REST APIs on the `Embdr` instance
 *
 * @api private
 */
Embdr.prototype._exposeApis = function() {
    var self = this;

    // Require each API
    var apis = {
        'Resources': require('./api/resources')(self)
    };

    // Expose each API on the embdr instance
    _.each(apis, function(api, name) {
        self[name[0].toLowerCase() + name.substring(1)] = api;
    });
};

/**
 * Execute an HTTP request against the REST API
 *
 * @param  {string}         method              The HTTP method to execute. For example, `GET`, `POST`, ..
 * @param  {string}         path                The path to direct the HTTP request at
 * @param  {Object}         data                The data to pass along in the HTTP request
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error object when the REST API could not be reached or returned a non-expected status code
 * @param  {Object}         callback.data       The data the REST API returned
 * @api private
 */
Embdr.prototype._request = function(method, path, data, callback) {
    var url = util.format('%s://%s:%d%s%s', this._api.protocol, this._api.host, this._api.port, this._api.basePath, path);

    var options = {
        'url': url,
        'method': method,
        'strictSSL': this._api.strictSSL,
        'headers': {
            'Authorization': this._api.auth
        }
    };
    // Sanitize the parameters to not include null / unspecified values
    data = data || {};
    _.each(data, function(value, key) {
        if (value === null || value === undefined) {
            delete data[key];
        } else if (_.isArray(value)) {
            // Filter out unspecified items from the parameter array, and remove it when empty
            value = _.compact(value);
            if (_.isEmpty(value)) {
                delete data[key];
            } else {
                data[key] = value;
            }
        }
    });

    // Keep track of whether we'll have to perform a multipart request
    var isMultipart = false;

    if (!_.isEmpty(data)) {
        if (options.method === 'GET') {
            options.qs = data;
        } else {
            // Depending on the data that is being passed along, we can either submit a URL-encoded request
            // or use multipart uploads. We will only use the latter if there's a stream or buffer
            // present in the provided data
            isMultipart = _.some(data, function(val) {
                return (val instanceof Stream || Buffer.isBuffer(val));
            });

            // Use simple URL encoding for regular POSTs
            if (!isMultipart) {
                options.form = data;
            }
        }
    }

    // Submit the request
    var r = request(options, function(err, response, body) {
        if (err) {
            return callback({'code': 500, 'message': util.format('Something went wrong trying to contact the server'), 'err': err});
        } else if (response.statusCode >= 400) {
            // The body will be a JSON object
            try {
                err = JSON.parse(body);
                err.code = response.statusCode;
            } catch (ex) {
                return callback({'code': response.statusCode, 'message': body});
            }

            return callback(err);
        }

        // Check if the response body is JSON
        try {
            body = JSON.parse(body);
        } catch (ex) {
            // Swallow the exception
        }

        return callback(null, body);
    });

    // When the request is a multipart POST request, we need to submit our regular form fields first
    // and our data files last. This is because the REST API will start processing as soon as it
    // sees a file. To ensure that the REST API has access to the thumbnail options we'll send those
    // first
    if (isMultipart) {
        // Get the request's form. See https://github.com/request/request#multipartform-data-multipart-form-uploads
        // for more information
        var form = r.form();

        _.pairs(data)
            // Ensure the Stream or Buffer parts are added last
            .sort(function(a) {
                if (a[1] instanceof Stream || Buffer.isBuffer(a[1])) {
                    return 1;
                }
            })

            // Add each part to the form
            .forEach(function(part) {
                if (part[0] && part[1]) {
                    form.append(part[0], part[1]);
                }
            });
    }
};
