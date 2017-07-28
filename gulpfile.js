/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

var gulp = require('gulp');
var clean = require('gulp-clean');
var run = require('gulp-run')

gulp.task('clean', function () {
    console.log('Cleaning build directories...');
    return gulp.src(['client/**/*.{js,d.ts}', 'server/**/*.{js,d.ts}', 'lib/**/*.{js,d.ts}', 'test/**/*.{js,d.ts}'], { read: false })
        .pipe(clean({ force: true }));
});

gulp.task('build', function () {
    console.log('Building code...');
    return gulp.src('./').pipe(run('tsc --project tsconfig.json'));
});
