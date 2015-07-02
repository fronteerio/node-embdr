/**
 * Copyright (c) 2015 "Fronteer LTD". All rights reserved.
 */

const gulp = require('gulp');
const eslint = require('gulp-eslint');

gulp.task('check-style', function() {
    const checkFiles = gulp.src(['lib/*.js']);

    return checkFiles
        .pipe(eslint())
        .pipe(eslint.formatEach())
        .pipe(eslint.failOnError());
});

gulp.task('default', ['check-style']);
