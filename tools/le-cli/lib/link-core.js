'use strict';
/* The shared core of assets/js/le-link.js (applyOps, diff, merge, outline), loaded from the app files so the tab,
   the engine and Node use one implementation of the operation vocabulary. */
const path = require('path');
const { siteRoot } = require('./static-server');

module.exports = require(path.join(siteRoot(), 'assets', 'js', 'le-link.js'));
