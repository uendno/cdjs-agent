const io = require('socket.io-client');
const eventSrv = require('./events');
const wsEvents = require('../config').wsEvents;

let socket;

exports.connect = (host, path, namespace, token) => {

    const url = host + namespace;

    socket = io.connect(url, {
        path,
        query: {
            token
        }
    });

    socket.on('connect', () => {
        console.log("Connected!");
    });

    socket.on('disconnect', () => {
        console.log("Disconnected!");
    });

    // socket.on('build', (job, build) => {
    //     const task = buildSrv(job, build);
    //     queueSrv.push(task);
    // });


    socket.on('ERROR', (error) => {
        console.log(error)
    });

    socket.on('error', (error) => {
        console.log(error)
    });

    socket.on(wsEvents.CREATE_AGENT_COMMUNICATION_TUNNEL, (buildId) => {
        eventSrv.emit(wsEvents.CREATE_AGENT_COMMUNICATION_TUNNEL, buildId);
        socket.emit(wsEvents.CREATE_AGENT_COMMUNICATION_TUNNEL_RESPONSE, buildId)
    });

    socket.on(wsEvents.SEND_MESSAGE_TO_AGENT, (buildId, message) => {
        eventSrv.emit(wsEvents.SEND_MESSAGE_TO_AGENT, buildId, message)
    });

    eventSrv.on(wsEvents.MESSAGE_FROM_AGENT, (buildId, message) => {
        socket.emit(wsEvents.MESSAGE_FROM_AGENT, buildId, message);
    });
};