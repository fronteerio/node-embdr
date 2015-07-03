# Embdr Client for Node.JS

The Node.JS client to communicate with the Embdr REST API

## Dependencies

 * Node.JS

## Installation

You can install the client through [NPM](https://www.npmjs.org/package/embdr)

```
npm install embdr
```

## Example

```javascript
var Embdr = require('embdr');

// Create a new embdr instance
var embdr = new Embdr('VUT6blsAabPE2Vw7BkDZiCJ45duoBtit');

// Process a file on disk
embdr.process('path/to/my/file.xlsx', {
    // Invoked when something went wrong trying to contact the Embdr REST API
    'error': function(err) {
        console.error('Failed to process a resource');
        console.error(err);
    },

    // Invoked when the upload request finishes
    'start': function(resource) {
        console.log('Uploaded a resource for processing');
        console.log(resource);
    },

    'thumbnails': {
        // Specify the desired sizes of the thumbnails
        'sizes': ['64x64', '256x256'],

        // Invoked when the thumbnails are ready
        'complete': function(thumbnails) {
            console.log('Generated thumbnails');
            console.log(thumbnails);
        }
    },

    // Invoked when the entire file has been processed
    'complete': function(resource) {
        console.log('Completely processed a resource');
        console.log(resource);
    }
});
```

The `process` function is overloaded and can take other types such as HTTP links:
```
var url = 'https://upload.wikimedia.org/wikipedia/meta/b/be/Wikipedia-logo-v2_2x.png';
embdr.process(url, {
    'complete': function(resource) {
        console.log('Completely processed a URL
        ');
        console.log(resource);
    }
});
```

It can also take in any kind of readable stream:
```
var stream = myFunctionThatReturnsAStream();

embdr.process(stream, {
    'complete': function(resource) {
        console.log('Completely processed a resource');
        console.log(resource);
    }
});
```

## Documentation

TODO
