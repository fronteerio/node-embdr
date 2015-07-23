/**
 * Copyright (c) 2015 "Fronteer LTD". All rights reserved.
 */

var _ = require('lodash');
var fs = require('fs');

var ProcessrUtil = require('../util');

module.exports = function(processr) {

    var apis = {

        /**
         * Create and process a file
         *
         * @param  {stream}     file                            A stream that holds the data for a file that should be uploaded and processed
         * @param  {Object}     [options]                       A set of extra options
         * @param  {string[]}   [options.thumbnailSizes]        A set of thumbnail dimensions
         * @param  {Function}   callback                        Standard callback function
         * @param  {Error}      callback.err                    The error object as returned by the REST API. If no error occurred, this value will be `null`
         * @param  {Object}     callback.data                   The data as returned by the REST API. If the request errored, this value will be `null`
         */
        'createFile': function(file, options, callback) {
            // If the file is a string, we assume it's a path on disk
            if (_.isString(file)) {
                try {
                    file = fs.createReadStream(file);
                } catch (err) {
                    return callback({'message': 'A stream could not be opened for the provided path', 'err': err});
                }
            }

            // Attach an error listener to the stream
            file.on('error', function(err) {
                return callback({'message': 'An error occurred when reading from the stream', 'err': err});
            });

            // Upload the file
            var data = {'file': file};
            addSizes(data, options, 'thumbnailSizes');
            addSizes(data, options, 'imagePreviewSizes');
            return processr._request('POST', '/resources', data, callback);
        },

        /**
         * Create and process a link
         *
         * @param  {string}     link                            The link that should be processed
         * @param  {Object}     [options]                       A set of extra options
         * @param  {string[]}   [options.thumbnailSizes]        A set of thumbnail dimensions
         * @param  {Function}   callback                        Standard callback function
         * @param  {Error}      callback.err                    The error object as returned by the REST API. If no error occurred, this value will be `null`
         * @param  {Object}     callback.data                   The data as returned by the REST API. If the request errored, this value will be `null`
         */
        'createLink': function(link, options, callback) {
            var data = {'link': link};
            addSizes(data, options, 'thumbnailSizes');
            addSizes(data, options, 'imagePreviewSizes');
            return processr._request('POST', '/resources', data, callback);
        },

        /**
         * Get a resource
         *
         * @param  {string}     id                  The id of the resource that should be retrieved
         * @param  {Function}   callback            Standard callback function
         * @param  {Error}      callback.err        The error object as returned by the REST API. If no error occurred, this value will be `null`
         * @param  {Object}     callback.data       The data as returned by the REST API. If the request errored, this value will be `null`
         */
        'get': function(id, callback) {
            var url = '/resources/' + ProcessrUtil.encodeURIComponent(id);
            return processr._request('GET', url, null, callback);
        }
    };

    /*!
     * Add the given sizes from `options` in the `data` object
     *
     * @param {Object}      data            The data object to add the sizes in
     * @param {Object}      options         The options object to pull the sizes out
     * @param {String}      name            The name of the sizes. For example, thumbnailSizes or imagePreviewSizes
     */
    var addSizes = function(data, options, name) {
        if (!options[name]) {
            return;
        }

        var sizes = options[name]
        if (_.isArray(sizes)) {
            sizes = sizes.join(',');
        }
        data[name] = sizes;
    };

    return apis;
};
