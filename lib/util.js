/**
 * Copyright (c) 2015 "Fronteer LTD". All rights reserved.
 */

'use strict';

/**
 * Utility wrapper around the native JS encodeURIComponent function, to make sure that
 * encoding null doesn't return "null". In tests, null will often be passed in to validate
 * validation, and there's no need to catch the "null" string everywhere.
 *
 * @param  {String}     uriComponent        The URL part to encode and make URL safe
 * @return {String}                         The encoded URL part. When null was passed in, this will return ''
 */
module.exports.encodeURIComponent = function(uriComponent) {
    return (uriComponent === null) ? '' : encodeURIComponent(uriComponent);
};
