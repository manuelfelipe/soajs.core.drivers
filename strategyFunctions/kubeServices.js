'use strict';

const utils = require('../utils/utils.js');
const lib = utils.kubeLib;

const errorFile = require('../utils/errors.js');

const async = require('async');
const request = require('request');
const gridfsColl = 'fs.files';

var engine = {
    /**
     * Adds a node to a cluster
     * todo: should be deprecated
     * @param {Object} options
     * @param {Function} cb
     *
     */
    listServices (options, cb) {
        lib.getDeployer(options, (error, deployer) => {
            utils.checkError(error, 520, cb, () => {
                let filter = {};
                if (options.params && options.params.env && !options.params.custom) {
                    filter = {
                        labelSelector: 'soajs.content=true, soajs.env.code=' + options.params.env
                    };
                }
                else if (options.params && options.params.custom) {
                    filter = {
                        labelSelector: 'soajs.content != true'
                    };
                }

                deployer.extensions.namespaces.deployments.get({qs: filter}, (error, deploymentList) => {
                    utils.checkError(error, 536, cb, () => {
                        deployer.extensions.namespaces.daemonsets.get({qs: filter}, (error, daemonsetList) => {
                            utils.checkError(error, 663, cb, () => {
                                let deployments = [];
                                if (deploymentList && deploymentList.items) deployments = deployments.concat(deploymentList.items);
                                if (daemonsetList && daemonsetList.items) deployments = deployments.concat(daemonsetList.items);

                                async.map(deployments, (oneDeployment, callback) => {
                                    filter = {
                                        labelSelector: 'soajs.content=true, soajs.env.code=' + options.params.env + ', soajs.service.label= ' + oneDeployment.metadata.name
                                    };
                                    deployer.core.namespaces.services.get({qs: filter}, (error, serviceList) => {
                                        if (error) {
                                            return callback(error);
                                        }

                                        let record = lib.buildDeploymentRecord({ deployment: oneDeployment , service: serviceList.items[0] });

                                        if (options.params && options.params.excludeTasks) {
                                            return callback(null, record);
                                        }

                                        filter = {
                                            labelSelector: 'soajs.content=true, soajs.service.label=' + record.name
                                        };
                                        deployer.core.namespaces.pods.get({qs: filter}, (error, podsList) => {
                                            if (error) {
                                                return callback(error);
                                            }

                                            async.map(podsList.items, (onePod, callback) => {
                                                return callback(null, lib.buildPodRecord({ pod: onePod }));
                                            }, (error, pods) => {
                                                if (error) {
                                                    return callback(error);
                                                }

                                                record.tasks = pods;
                                                return callback(null, record);
                                            });
                                        });
                                    });
                                }, cb);
                            });
                        });
                    });
                });
            });
        });
    },

    /**
     * Creates a new deployment for a SOAJS service
     *
     * @param {Object} options
     * @param {Function} cb
     *
     */
    deployService (options, cb) {
        options.params.variables.push('SOAJS_DEPLOY_HA=kubernetes');

        let service = utils.cloneObj(require(__dirname + '/../schemas/kubernetes/service.template.js'));
        service.metadata.name = cleanLabel(options.params.name);
        if (options.params.labels['soajs.service.name'] !== 'controller') {
            service.metadata.name += '-service';
        }

        service.metadata.labels = options.params.labels;
        service.spec.selector = { 'soajs.service.label': options.params.labels['soajs.service.label'] };

        if (options.params.ports && options.params.ports.length > 0) {
            options.params.ports.forEach((onePortEntry, portIndex) => {
                let portConfig = {
                    protocol: 'TCP',
                    name: onePortEntry.name || 'port-' + portIndex,
                    port: onePortEntry.target,
                    targetPort: onePortEntry.target
                };

                if (onePortEntry.isPublished) {
                    if (!service.spec.type || service.spec.type !== 'NodePort') {
                        service.spec.type = 'NodePort';
                    }
                    portConfig.nodePort = onePortEntry.published;
                    portConfig.name = onePortEntry.name || 'published-' + portConfig.name;
                }

                service.spec.ports.push(portConfig);
            });
        }
        let payload = {};
        if (options.params.replication.mode === 'deployment') {
            payload = utils.cloneObj(require(__dirname + '/../schemas/kubernetes/deployment.template.js'));
            options.params.type = 'deployment';
        }
        else if (options.params.replication.mode === 'daemonset') {
            payload = utils.cloneObj(require(__dirname + '/../schemas/kubernetes/daemonset.template.js'));
            options.params.type = 'daemonset';
        }

        payload.metadata.name = cleanLabel(options.params.name);
        payload.metadata.labels = options.params.labels;
        payload.metadata.labels['soajs.service.label'] = cleanLabel(payload.metadata.labels['soajs.service.label']);

        if (options.params.type === 'deployment') {
            payload.spec.replicas = options.params.replicaCount;
        }

        payload.spec.selector.matchLabels = { 'soajs.service.label': cleanLabel(options.params.labels['soajs.service.label']) };
        payload.spec.template.metadata.name = cleanLabel(options.params.labels['soajs.service.name']);
        payload.spec.template.metadata.labels = options.params.labels;
        //NOTE: only one container is being set per pod
        payload.spec.template.spec.containers[0].name = cleanLabel(options.params.labels['soajs.service.name']);
        payload.spec.template.spec.containers[0].image = options.params.image;
        payload.spec.template.spec.containers[0].workingDir = ((options.params.containerDir) ? options.params.containerDir : '');
        payload.spec.template.spec.containers[0].command = [options.params.cmd[0]];
        payload.spec.template.spec.containers[0].args = options.params.cmd.splice(1);
        payload.spec.template.spec.containers[0].env = lib.buildEnvList({ envs: options.params.variables });

        //NOTE: add kubectl container only for controller deployments, required tp proxy requests
        //NOTE: static values are set for kubectl container, no need to make it dynamic for now
        if (options.params.labels['soajs.service.name'] === 'controller') {
            payload.spec.template.spec.containers.push({
                "name": "kubectl-proxy",
                "image": "lachlanevenson/k8s-kubectl",
                "imagePullPolicy": "IfNotPresent",
                "args": ["proxy", "-p", "8001"],
                "ports": [
                    {

                        "containerPort": 8001
                    }
                ]
            });
        }

        //NOTE: only one volume is supported for now
        if (options.params.volume) {
            payload.spec.volumes.push({
                name: options.params.volume.name,
                hostPath: {
                    path: options.params.volume.source
                }
            });

            payload.spec.template.spec.containers[0].volumeMounts.push({
                mountPath: options.params.volume.target,
                name: options.params.volume.name
            });
        }

        if (process.env.SOAJS_TEST) {
            //using lightweight image and commands to optimize travis builds
            //the purpose of travis builds is to test the dashboard api, not the containers
            payload.spec.template.spec.containers[0].image = 'alpine:latest';
            payload.spec.template.spec.containers[0].command = ['sh'];
            payload.spec.template.spec.containers[0].args = ['-c', 'sleep 36000'];
        }

        lib.getDeployer(options, (error, deployer) => {
            utils.checkError(error, 540, cb, () => {
                deployer.core.namespaces.services.post({ body: service }, (error) => {
                    utils.checkError(error, 525, cb, () => {
                        deployer.extensions.namespaces[options.params.type].post({ body: payload }, (error) => {
                            utils.checkError(error, 526, cb, cb.bind(null, null, true));
                        });
                    });
                });
            });
        });

        function cleanLabel(label) {
            return label.toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
        }
    },

    /**
     * Scales a deployed services up/down depending on current replica count and new one
     * @param {Object} options
     * @param {Function} cb
     *
     */
    scaleService (options, cb) {
        lib.getDeployer(options, (error, deployer) => {
            utils.checkError(error, 520, cb, () => {
                deployer.extensions.namespaces.deployments.get({name: options.params.id}, (error, deployment) => {
                    utils.checkError(error, 536, cb, () => {
                        deployment.spec.replicas = options.params.scale;
                        deployer.extensions.namespaces.deployments.put({name: options.params.id, body: deployment}, (error, result) => {
                            utils.checkError(error, 527, cb, cb.bind(null, null, true));
                        });
                    });
                });
            });
        });
    },

    /**
     * Redeploy a service
     *
     * @param {Object} options
     * @param {Function} cb
     *
     */
    redeployService (options, cb) {
        let contentType = options.params.mode;
        lib.getDeployer(options, (error, deployer) => {
            utils.checkError(error, 520, cb, () => {
                deployer.extensions.namespaces[contentType].get({name: options.params.id}, (error, deployment) => {
                    utils.checkError(error, 536, cb, () => {
                        let check = (deployment.spec && deployment.spec.template && deployment.spec.template.spec && deployment.spec.template.spec.containers && deployment.spec.template.spec.containers[0]);
                        utils.checkError(!check, 653, cb, () => {
                            if (!deployment.spec.template.spec.containers[0].env) deployment.spec.template.spec.containers[0].env = [];
                            deployment.spec.template.spec.containers[0].env.push({ name: 'SOAJS_REDEPLOY_TRIGGER', value: 'true' });

                            if (options.params.ui) { //in case of rebuilding nginx, pass custom ui environment variables
                                deployment.spec.template.spec.containers[0].env.push({ name: 'SOAJS_GIT_REPO', value: options.params.ui.repo });
                                deployment.spec.template.spec.containers[0].env.push({ name: 'SOAJS_GIT_OWNER', value: options.params.ui.owner });
                                deployment.spec.template.spec.containers[0].env.push({ name: 'SOAJS_GIT_BRANCH', value: options.params.ui.branch });
                                deployment.spec.template.spec.containers[0].env.push({ name: 'SOAJS_GIT_COMMIT', value: options.params.ui.commit });
                                deployment.spec.template.spec.containers[0].env.push({ name: 'SOAJS_GIT_COMMIT', value: options.params.ui.commit });
                                deployment.spec.template.spec.containers[0].env.push({ name: 'SOAJS_GIT_PROVIDER', value: options.params.ui.provider });
                                deployment.spec.template.spec.containers[0].env.push({ name: 'SOAJS_GIT_DOMAIN', value: options.params.ui.domain });

                                if (options.params.ui.token) {
                                    deployment.spec.template.spec.containers[0].env.push({ name: 'SOAJS_GIT_TOKEN', value: options.params.ui.token });
                                }
                            }

                            deployer.extensions.namespaces[contentType].put({ name: options.params.id, body: deployment }, (error) => {
                                utils.checkError(error, 653, cb, cb.bind(null, null, true));
                            });
                        });
                    });
                });
            });
        });
    },

    /**
     * Gathers and returns information about specified service and a list of its tasks/pods
     *
     * @param {Object} options
     * @param {Function} cb
     *
     */
    inspectService (options, cb) {
        lib.getDeployer(options, (error, deployer) => {
            utils.checkError(error, 520, cb, () => {
                deployer.extensions.namespaces.deployment.get(options.params.id, (error, deployment) => {
                    utils.checkError(error, 536, cb, () => {
                        let deploymentRecord = lib.buildDeploymentRecord({ deployment });

                        if (options.params.excludeTasks) {
                            return cb(null, { deployment: deploymentRecord });
                        }

                        deployer.core.namespaces.pods.get({qs: {labelSelector: 'soajs.service.label=' + options.params.id}}, (error, podList) => {
                            utils.checkError(error, 529, cb, () => {
                                async.map(podList.items, (onePod, callback) => {
                                    return callback(null, lib.buildPodRecord({ pod: onePod }));
                                }, (error, pods) => {
                                    return cb(null, { service: deploymentRecord, tasks: pods });
                                });
                            });
                        });
                    });
                });
            });
        });
    },

    /**
     * Takes environment code and soajs service name and returns corresponding swarm service
     *
     * @param {Object} options
     * @param {Function} cb
     *
     */
    findService (options, cb) { //TODO: test
        lib.getDeployer(options, (error, deployer) => {
            utils.checkError(error, 520, cb, () => {
                let filter = {
                    labelSelector: 'soajs.content=true, soajs.env.code=' + options.params.env + ', soajs.service.name=' + options.params.serviceName
                };

                if (options.params.version) {
                    filter.labelSelector += ', soajs.service.version=' + options.params.version;
                }

                deployer.extensions.namespaces.deployments.get({qs: filter}, (error, deploymentList) => {
                    utils.checkError(error, 549, cb, () => {
                        utils.checkError(deploymentList.items.length === 0, 657, cb, () => {
                            deployer.core.namespaces.services.get({qs: filter}, (error, serviceList) => {
                                utils.checkError(error, 533, cb, () => {
                                    return cb(null, lib.buildDeploymentRecord ({ deployment: deploymentList.items[0], service: serviceList.items[0] }));
                                });
                            });
                        });
                    });
                });
            });
        });
    },

    /**
     * Deletes a deployed service, kubernetes deployment or daemonset
     *
     * @param {Object} options
     * @param {Function} cb
     *
     */
    deleteService (options, cb) {
        let contentType = options.params.mode;
        if (contentType === 'deployment') {
            options.params.scale = 0;
            engine.scaleService(options, (error) => {
                utils.checkError(error, 527, cb, () => {
                    deleteContent();
                });
            });
        }
        else {
            deleteContent();
        }

        function deleteContent() {
            lib.getDeployer(options, (error, deployer) => {
                utils.checkError(error, 520, cb, () => {
                    deployer.extensions.namespaces[contentType].delete({name: options.params.id, qs: { gracePeriodSeconds: 0 }}, (error) => {
                        utils.checkError(error, 534, cb, () => {
                            let filter = {
                                labelSelector: 'soajs.service.label=' + options.params.id //kubernetes references content by name not id, therefore id field is set to content name
                            };
                            deployer.core.namespaces.services.get({qs: filter}, (error, servicesList) => { //only one service for a given service can exist
                                utils.checkError(error, 533, cb, () => {
                                    if (servicesList && servicesList.items.length > 0) {
                                        async.each(servicesList.items, (oneService, callback) => {
                                            deployer.core.namespaces.services.delete({name: oneService.metadata.name}, callback);
                                        }, (error) => {
                                            utils.checkError(error, 534, cb, () => {
                                                cleanup(deployer, filter);
                                            });
                                        });
                                    }
                                    else {
                                        cleanup(deployer, filter);
                                    }
                                });
                            });
                        });
                    });
                });
            });
        }

        function cleanup(deployer, filter) {
            deployer.extensions.namespaces.replicasets.delete({qs: filter}, (error) => {
                utils.checkError(error, 532, cb, () => {
                    deployer.core.namespaces.pods.delete({qs: filter}, (error) => {
                        utils.checkError(error, 660, cb, cb.bind(null, null, true));
                    });
                });
            });
        }
    },

    /**
     * Gathers and returns information about a specified pod
     *
     * @param {Object} options
     * @param {Function} cb
     *
     */
    inspectTask (options, cb) {
        lib.getDeployer(options, (error, deployer) => {
            utils.checkError(error, 540, cb, () => {
                deployer.core.namespaces.pods.get({ name: options.params.taskId }, (error, pod) => {
                    utils.checkError(error, 656, cb, () => {
                        return cb(null, lib.buildPodRecord({ pod }));
                    });
                });
            });
        });
    },

    /**
     * Collects and returns a container logs based on a pre-defined 'tail' value
     *
     * @param {Object} options
     * @param {Function} cb
     *
     */
    getContainerLogs (options, cb) {

        let res = options.res;
        delete options.res;
        lib.getDeployer(options, (error, deployer) => {
            check(error, 520, () => {

                let params = {
                    name: options.params.taskId, //pod name
                    qs: {
                        tailLines: options.params.tail || 400
                    }
                };

                deployer.core.namespaces.pods.get({name: options.params.taskId}, (error, pod) => {
                    check(error, 656, () => {
                        //NOTE: controllers have two containers per pod, kubectl and controller service
                        //NOTE: filter out the kubectl container and only get logs of controller
                        if (pod.spec && pod.spec.containers && pod.spec.containers.length > 0) {
                            let controllerContainer = {};
                            for (let i = 0; i < pod.spec.containers.length; i++) {
                                if (pod.spec.containers[i].name.indexOf('controller') !== -1) {
                                    controllerContainer = pod.spec.containers[i];
                                    break;
                                }
                            }

                            if (controllerContainer) {
                                params.qs.container = controllerContainer.name;
                            }


                            deployer.core.namespaces.pods.log(params, (error, logs) => {
                                check(error, 537, () => {
                                    if(cb)
                                        return cb(null,logs);
                                    return res.jsonp(options.soajs.buildResponse(null, { data: logs }));
                                });
                            });
                        }
                    });
                });
            });
        });

        function check(error, code, cb1) {
            if (error && !cb) {
                return res.jsonp(options.soajs.buildResponse({code: code, msg: errorFile[code]}));
            }
            else if (error && cb) {
                return cb({code: code, msg: errorFile[code]});
            }
            return cb1();
        }
    },

    /**
     * Perform a SOAJS maintenance operation on a given service
     *
     * @param {Object} options
     * @param {Function} cb
     *
     */
    maintenance (options, cb) {
        lib.getDeployer(options, (error, deployer) => {
            utils.checkError(error, 520, cb, () => {
                let filter = {
                    labelSelector: 'soajs.service.label=' + options.params.id //kubernetes references content by name not id, therefore id field is set to content name
                };
                deployer.core.namespaces.pods.get({qs: filter}, (error, podsList) => {
                    utils.checkError(error, 659, cb, () => {
                        utils.checkError(podsList.items.length == 0, 657, cb, () => {
                            async.map(podsList.items, (onePod, callback) => {
                                let podInfo = {
                                    id: onePod.metadata.name,
                                    ipAddress: ((onePod.status && onePod.status.podIP) ? onePod.status.podIP : null)
                                };
                                return callback(null, podInfo);
                            }, (error, targets) => {
                                async.map(targets, (oneTarget, callback) => {
                                    if (!oneTarget.ipAddress) {
                                        return callback(null, {
                                            result: false,
                                            ts: new Date().getTime(),
                                            error: {
                                                msg: 'Unable to get the ip address of the pod'
                                            }
                                        });
                                    }

                                    let requestOptions = {
                                        uri: 'http://' + oneTarget.ipAddress + ':' + options.params.maintenancePort + '/' + options.params.operation,
                                        json: true
                                    };
                                    request.get(requestOptions, (error, response, body) => {
                                        let operationResponse = {
                                            id: oneTarget.id,
                                            response: {}
                                        };

                                        if (error) {
                                            operationResponse.response = {
                                                result: false,
                                                ts: new Date().getTime(),
                                                error: error
                                            };
                                        }
                                        else {
                                            operationResponse.response = body;
                                        }

                                        return callback(null, operationResponse);
                                    });
                                }, cb);
                            });
                        });
                    });
                });
            });
        });
    },

    /**
     * Get the latest version of a deployed service
     * Returns integer: service version
     * @param {Object} options
     * @param {Function} cb
     *
     */
    getLatestVersion (options, cb) {
        let latestVersion = 0;
        lib.getDeployer(options, (error, deployer) => {
            utils.checkError(error, 520, cb, () => {
                let filter = {
                    labelSelector: 'soajs.content=true, soajs.env.code=' + options.params.env + ', soajs.service.name=' + options.params.serviceName
                };

                deployer.extensions.deployments.get({qs: filter}, (error, deploymentList) => {
                    utils.checkError(error, 536, cb, () => {
                        utils.checkError(deploymentList.items.length == 0, 657, cb, () => {
                            deploymentList.items.forEach((oneDeployment) => {
                                if (oneDeployment.metadata && oneDeployment.metadata.labels) {
                                    let v = oneDeployment.metadata.labels['soajs.service.version'];

                                    if (v > latestVersion) {
                                        latestVersion = v;
                                    }
                                }
                            });
                        });
                        return cb(null, latestVersion);
                    });
                });
            });
        });
    },

    /**
     * Get the domain/host name of a deployed service (per version)
     *
     * @param {Object} options
     * @param {Function} cb
     *
     */
    getServiceHost (options, cb) {
        lib.getDeployer(options, (error, deployer) => {
            utils.checkError(error, 520, cb, () => {
                let filter = {
                    labelSelector: 'soajs.content=true, soajs.env.code=' + options.params.env + ', soajs.service.name=' + options.params.serviceName
                };

                if (options.params.version) {
                    filter.labelSelector += ', soajs.service.version=' + options.params.version;
                }

                deployer.core.services.get({qs: filter}, (error, serviceList) => {
                    utils.checkError(error, 549, cb, () => {
                        if (serviceList.items.length === 0) {
                            return cb({message: 'Service not found'});
                        }

                        //only one service must match the filter, therefore serviceList will contain only one item
                        return cb(null, serviceList.items[0].metadata.name);
                    });
                });
            });
        });
    }
};

module.exports = engine;