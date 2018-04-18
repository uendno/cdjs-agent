const simpleGit = require('simple-git/promise');
const child_process = require('child_process');
const path = require('path');
const Promise = require('bluebird');
const Url = require('url');
const mkdirp = require('mkdirp');
const fs = require('fs-extra');
const eventEmitter = require('./events');
const config = require('../config');
const dirHelper = require('../helpers/dir');
const wsEvents = config.wsEvents;
const agentMessages = config.agentMessages;

const buildControllers = [];

const ansiEscape = (string) => string.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

/**
 * Create source code directory if needed, notify web clients that build is starting
 * @param build
 * @param job
 * @param log
 */
const prepareDir = (build, job, log) => {

    const buildPath = dirHelper.getBuildDir(job.slug, build.number);

    // Make job directory if needed
    return new Promise((resolve, reject) => {
        mkdirp(buildPath, (error) => {
            if (error) return reject(error);

            return resolve(buildPath);
        })
    })
};

/**
 * Git clone, use defined credentials
 * @param job
 * @param repoPath
 * @param log
 * @returns {*}
 */
const clone = (job, repoPath, log) => {
    const credential = job.credential;

    if (!fs.existsSync(repoPath)) {
        const url = Url.parse(job.repoUrl);

        log("Cloning repo at url: " + job.repoUrl, 'info', {
            label: 'system'
        });

        if (credential) {
            switch (credential.type) {
                case 'username/password':
                    url.auth = credential.data.username + ":" + credential.data.password
            }
        }

        const gitCli = simpleGit();
        return gitCli.clone(Url.format(url), repoPath);
    } else {
        return Promise.resolve();
    }
};

/**
 * Checkout to defined branch
 * @param job
 * @param repoPath
 * @param log
 */
const checkout = (job, repoPath, log) => {
    // check out, pull and update submodules
    const gitCli = simpleGit(repoPath);
    const branch = job.branch;


    log('Pull code and checkout to branch: ' + branch, 'info', {
        label: 'system'
    });

    return gitCli.pull('origin', branch)
        .then(() => gitCli.checkout(branch));
};

/**
 * Install npm packages
 * @param job
 * @param repoPath
 * @param log
 */
const npmInstall = (job, repoPath, log) => {

    log('Running npm install...', 'info', {
        label: 'system'
    });

    const cli = child_process.spawn('yarn || npm install', {
        cwd: repoPath,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    cli.stdout.on('data', data => log(ansiEscape(data.toString()), 'info'));
    cli.stderr.on('data', data => log(ansiEscape(data.toString()), 'error'));

    return new Promise((resolve, reject) => {
        cli.on('close', (code) => {
            if (code !== 0) {
                const error = new Error('Job exited with code: ' + code);
                error.code = code;
                return reject(error);
            } else {
                return resolve();
            }
        });
    })
};

/**
 * Execute cd.js file
 * @param build
 * @param job
 * @param repoPath
 * @param env
 * @param log
 * @param saveBuild
 */
const runScript = (build, job, repoPath, env, log, saveBuild) => {

    const cdjsFilePath = path.join(repoPath, job.cdFilePath);

    return fs.exists(cdjsFilePath)
        .then(exists => {
            if (!exists) {
                throw new Error(job.cdFilePath + " does not exist!");
            }

            log(`Executing cd.js file at: ${cdjsFilePath}`, 'info', {
                label: 'system'
            });
            build.status = 'building';

            saveBuild(build);

            return build;
        })
        .then(build => {

            return new Promise((resolve, reject) => {
                const cli = child_process.spawn('node cd.js', {
                    cwd: repoPath,
                    env: Object.assign(process.env, env, {
                        CDJS_GIT_USERNAME: job.credential && job.credential.data.username,
                        CDJS_GIT_PASSWORD: job.credential && job.credential.data.password
                    }),
                    shell: true,
                    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
                });


                cli.stdout.on('data', data => {
                    log(ansiEscape(data.toString()), 'info')
                });

                cli.stderr.on('data', data => {
                    log(ansiEscape(data.toString()), 'error')
                });


                const updateStage = (name, data) => {
                    build.stages = build.stages.map(stage => {
                        if (stage.name === name) {
                            return Object.assign(stage, data)
                        } else {
                            return stage;
                        }
                    });

                    saveBuild(build);
                };


                cli.on('message', message => {
                    switch (message.type) {
                        case 'stages': {
                            const stages = message.data;
                            build.stages = stages.map(name => {
                                return {
                                    build: build._id,
                                    name,
                                    status: 'pending'
                                }
                            });

                            saveBuild(build);
                            break;
                        }

                        case 'stage-start': {
                            const name = message.data;

                            updateStage(name, {
                                status: 'building',
                                startAt: Date.now()
                            });

                            break;
                        }

                        case 'stage-success': {
                            const name = message.data;

                            updateStage(name, {
                                status: 'success',
                                doneAt: Date.now()
                            });

                            break;
                        }

                        case 'stage-failed': {
                            const name = message.data;
                            updateStage(name, {
                                status: 'failed',
                                doneAt: Date.now()
                            });

                            break;
                        }

                    }
                });

                cli.on('close', (code) => {

                    if (code !== 0) {
                        const error = new Error('Job exited with code: ' + code);
                        error.code = code;
                        return reject(error);
                    } else {
                        return resolve();
                    }
                });
            });
        });
};


/**
 * Send message to master
 * @param buildId
 * @param message
 */
const sendMessage = (buildId, message) => {
    eventEmitter.emit(wsEvents.MESSAGE_FROM_AGENT, buildId, message)
};

/**
 * Create a error handler
 * @param buildId
 */
const createErrorHandler = (buildId) => (error) => {
    const message = {
        type: agentMessages.ERROR,
        data: {
            error: {
                message: error.message,
                stack: error.stack
            }
        }
    };

    sendMessage(buildId, message)
};

/**
 * Create a listener which listens for commands from the master
 * @param buildId
 * @returns {function(*)}
 */
const createListener = (buildId) => {

    const debug = require('debug')('build:' + buildId);

    let env;
    let repoPath;

    const log = (message, level, options) => {

        debug('Sending: ' + agentMessages.LOG);

        sendMessage(buildId, {
            type: agentMessages.LOG,
            data: {
                message,
                level,
                options
            }
        })
    };

    const saveBuild = (build) => {
        debug('Sending: ' + agentMessages.SAVE_BUILD);

        sendMessage(buildId, {
            type: agentMessages.SAVE_BUILD,
            data: {
                build
            }
        })
    };

    return (message) => {
        const data = message.data;

        debug('Receive: ' + message.type);

        switch (message.type) {

            case agentMessages.SET_ENV: {
                env = data;
                return sendMessage(buildId, {
                    type: agentMessages.SET_ENV_COMPLETE,
                })
            }

            case agentMessages.PREPARE_DIR: {
                return prepareDir(data.build, data.job, log)
                    .then(() => {
                        repoPath = dirHelper.getRepoDir(data.job.name, data.job.repoUrl);

                        debug('Sending: ' + agentMessages.PREPARE_DIR_COMPLETE);

                        sendMessage(buildId, {
                            type: agentMessages.PREPARE_DIR_COMPLETE,
                        })
                    })
                    .catch(createErrorHandler(buildId))
            }

            case agentMessages.CLONE: {
                return clone(data.job, repoPath, log)
                    .then(() => {

                        debug('Sending: ' + agentMessages.CLONE_COMPLETE);

                        sendMessage(buildId, {
                            type: agentMessages.CLONE_COMPLETE,
                        })
                    })
                    .catch(createErrorHandler(buildId))
            }

            case agentMessages.CHECK_OUT: {
                return checkout(data.job, repoPath, log)
                    .then(() => {

                        debug('Sending: ' + agentMessages.CHECK_OUT_COMPLETE);

                        sendMessage(buildId, {
                            type: agentMessages.CHECK_OUT_COMPLETE,
                        })
                    })
                    .catch(createErrorHandler(buildId))
            }

            case agentMessages.NPM_INSTALL: {
                return npmInstall(data.job, repoPath, log)
                    .then(() => {

                        debug('Sending: ' + agentMessages.NPM_INSTALL_COMPLETE);

                        sendMessage(buildId, {
                            type: agentMessages.NPM_INSTALL_COMPLETE,
                        })
                    })
                    .catch(createErrorHandler(buildId))
            }

            case agentMessages.RUN_SCRIPT: {
                return runScript(data.build, data.job, repoPath, env, log, saveBuild)
                    .then(() => {

                        debug('Sending: ' + agentMessages.RUN_SCRIPT_COMPLETE);

                        sendMessage(buildId, {
                            type: agentMessages.RUN_SCRIPT_COMPLETE,
                        })
                    })
                    .catch(createErrorHandler(buildId))
            }

            case agentMessages.DONE: {
                removeController(buildId);
            }
        }
    }
};


/**
 * Remove a build controller
 l * @param buildId
 */
const removeController = (buildId) => {
    const controller = buildControllers.find(b => b.buildId === buildId);
    buildControllers.splice(buildControllers.indexOf(controller), 1);
};


/**
 * On receive message
 */
eventEmitter.on(wsEvents.SEND_MESSAGE_TO_AGENT, (buildId, message) => {
    const controller = buildControllers.find(b => b.buildId === buildId);

    if (controller) {
        controller.listener(message);
    }
});

/**
 * On receive create tunnel request
 */
eventEmitter.on(wsEvents.CREATE_AGENT_COMMUNICATION_TUNNEL, buildId => {
    buildControllers.push({
        buildId,
        listener: createListener(buildId)
    })
});

exports.removeController = removeController;