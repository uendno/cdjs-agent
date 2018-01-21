const gitUrlParse = require('git-url-parse');
const config = require('../config');

exports.getJobDir = (jobSlug) => {
    return config.workspace + "/" + jobSlug;
};

exports.getRepoDir = (jobSlug, repoUrl) => {
    return exports.getJobDir(jobSlug) + "/" + gitUrlParse(repoUrl).name;
};

exports.getBuildDir = (jobSlug, buildNumber) => {
    return exports.getJobDir(jobSlug) + "/builds/" + buildNumber;
};