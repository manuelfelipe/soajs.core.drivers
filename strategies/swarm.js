/* jshint esversion: 6 */

"use strict";
const swarmNodes = require('../strategyFunctions/swarmNodes.js');
const swarmServices = require('../strategyFunctions/swarmServices');
const errorFile = require('../utils/errors.js');

const engine = {

    'inspectCluster': function(options, cb){
        swarmNodes.inspectCluster(options, cb);
	},

    'addNode': function(options, cb){
    	swarmNodes.addNode(options, cb);
    },

    'removeNode': function(options, cb){
    	swarmNodes.removeNode(options, cb);
    },

    'updateNode': function(options, cb){
    	swarmNodes.updateNode(options, cb);
    },

	'inspectNode': function(options, cb){
    	swarmNodes.inspectNode(options,cb);
    },

    'listNodes': function(options, cb){
		swarmNodes.listNodes(options, cb);
    },


    'listServices': function(options, cb){
        swarmServices.listServices(options, cb);
    },

    'deployService': function(options, cb){
        swarmServices.deployService(options, cb);
    },

    'redeployService': function(options, cb){
        swarmServices.redeployService(options, cb);
    },

    'scaleService': function(options, cb){
        swarmServices.scaleService(options, cb);
    },

    'inspectService': function(options, cb){
        swarmServices.inspectService(options, cb);
    },

    'findService': function(options, cb){
        swarmServices.findService(options, cb);
    },

    'deleteService': function(options, cb){
        swarmServices.deleteService(options, cb);
    },

    'inspectTask': function(options, cb){
        swarmServices.inspectTask(options, cb);
    },

    'getContainerLogs': function(options, cb){
        swarmServices.getContainerLogs(options, cb);
    },

    'maintenance': function(options, cb){
        swarmServices.maintenance(options, cb);
    },

    'getLatestVersion': function(options, cb){
        swarmServices.getLatestVersion(options, cb);
    },

    'getServiceHost': function(options, cb){
        swarmServices.getServiceHost(options, cb);
    }

};

module.exports = engine;
