import EventEmitter from 'events';
import flow from 'lodash/fp/flow';
import entries from 'lodash/fp/entries';
import fromPairs from 'lodash/fp/fromPairs';
import map from 'lodash/fp/map';
import omitBy from 'lodash/fp/omitBy';
import omit from 'lodash/fp/omit';
import values from 'lodash/fp/values';
import find from 'lodash/fp/find';
import curry from 'lodash/fp/curry';
import PQueue from 'p-queue';
import { rtcConfig } from './rtc-config.js';

export const PEER_UPDATED_EVENT = 'peerUpdated';

const getTransceivers = (pc) => pc.getTransceivers();

const findTransceiverById = (transceiverId, pc) =>
    flow(
        getTransceivers,
        find((transceiver) => transceiver.mid === transceiverId)
    )(pc);

const findInactiveTransceiver = flow(
    getTransceivers,
    find(
        (transceiver) =>
            transceiver.currentDirection === 'inactive' &&
            parseInt(transceiver.mid, 10) > 0
    )
);

const addTransceiver = curry(
    (pc, transceiver) =>
        transceiver ||
        pc.addTransceiver('video', {
            direction: 'recvonly',
        })
);

const addNewTransceiver = (pc) =>
    flow(findInactiveTransceiver, addTransceiver(pc))(pc);

export const createConnection = (
    gateway,
    eventEmitter,
    peerEventsEmitter,
    peerId
) => {
    let streamRegistry = {};
    const tasksQueue = new PQueue({
        concurrency: 1,
        autoStart: true,
    });

    const pc = new RTCPeerConnection({
        iceServers: rtcConfig.iceServers,
    });

    pc.addEventListener('track', handleAddTrack);
    pc.addEventListener('icecandidate', handleLocalIceCandidate);
    pc.addEventListener('negotiationneeded', () => {
        console.log('negotiation needed peer');
    });

    eventEmitter.on('iceCandidate', handleRemoteIceCandidate);
    eventEmitter.on('streamAdded', handleRemoteStreamAdded);
    eventEmitter.on('streamRemoved', handleStreamRemoved);

    pc.addTransceiver('audio', {
        direction: 'recvonly',
    });

    const connection = {
        publishVideo,
        connect,
        unpublishVideo,
        getStreams,
        getTransceivers,
        getLocalDescription,
        getRemoteDescription,
    };

    async function connect() {
        tasksQueue.add(async () => {
            const promise = new Promise((resolve) => {
                pc.addEventListener('signalingstatechange', () => {
                    if (pc.signalingState === 'stable') {
                        resolve();
                    }
                });
            });
            await signalOffer(await createOffer());
            return promise;
        });
        gateway.connect(peerId, eventEmitter);
    }

    async function publishVideo(stream) {
        console.log(`Publish upstream for peer ${peerId}`);
        tasksQueue.add(async () => {
            const sender = pc.addTrack(stream.getTracks()[0], stream);

            const offer = await createOffer();

            const transceiver = pc
                .getTransceivers()
                .find((transceiver) => transceiver.sender === sender);

            streamRegistry = {
                ...streamRegistry,
                [stream.id]: {
                    stream,
                    transceiverId: transceiver.mid,
                    peerId,
                    direction: 'up',
                },
            };

            peerEventsEmitter.emit(PEER_UPDATED_EVENT, streamRegistry);

            await signalOffer(offer);

            console.log(
                `Local transceivers list of the peer ${peerId} after successfull publishing upstream`,
                getTransceivers()
            );
        });
    }

    function unpublishVideo() {
        console.log(`Unpublish upstream of the peer ${peerId}`);
        eventEmitter.emit('upstreamRemoved');

        tasksQueue.add(async () => {
            const findUpstream = flow(
                values,
                find((stream) => stream.direction === 'up')
            );

            const upstreamData = findUpstream(streamRegistry);
            if (!upstreamData) {
                console.error('There is no active upstream');
                return;
            }

            const transceiver = findTransceiverById(
                upstreamData.transceiverId,
                pc
            );

            if (transceiver.currentDirection !== 'sendrecv') {
                transceiver.stop();
            } else {
                pc.removeTrack(transceiver.sender);
            }

            await signalOffer(await createOffer());

            streamRegistry = omitBy(
                (streamData) => streamData.direction === 'up',
                streamRegistry
            );
            peerEventsEmitter.emit(PEER_UPDATED_EVENT, streamRegistry);

            console.log(
                `Local transceivers list of the peer ${peerId} after successfull unblishing upstream`,
                getTransceivers()
            );
        });
    }

    function handleRemoteIceCandidate(candidate) {
        pc.addIceCandidate(candidate);
    }

    function handleAddTrack({ transceiver, streams }) {
        const addStreamToRegistry = flow(
            entries,
            map((stream) => {
                const [streamId, streamData] = stream;
                if (streamId === streams[0].id) {
                    return [
                        streamId,
                        {
                            ...streamData,
                            stream: streams[0],
                            transceiverId: transceiver.mid,
                        },
                    ];
                }

                return stream;
            }),
            fromPairs
        );
        streamRegistry = addStreamToRegistry(streamRegistry);
        peerEventsEmitter.emit(PEER_UPDATED_EVENT, streamRegistry);
    }

    function handleLocalIceCandidate({ candidate }) {
        if (candidate) {
            return;
        }

        eventEmitter.emit('peerIceCandidate', candidate);
    }

    async function handleRemoteStreamAdded({ streamId, peerId: remotePeerId }) {
        tasksQueue.add(async () => {
            console.log(
                `Downstream ${streamId} added for peer ${peerId}. Stream belongs to ${remotePeerId}`
            );

            addNewTransceiver(pc);

            streamRegistry = {
                ...streamRegistry,
                [streamId]: {
                    stream: null,
                    peerId: remotePeerId,
                    direction: 'down',
                },
            };

            await signalOffer(await createOffer());

            console.log(
                `Local transceivers list of peer ${peerId} after adding downstream`,
                getTransceivers()
            );
        });
    }

    function handleStreamRemoved(streamId) {
        console.log(`Removing downstream ${streamId} for peer ${peerId}`);
        tasksQueue.add(async () => {
            const transceiver = findTransceiverById(
                streamRegistry[streamId].transceiverId,
                pc
            );

            if (transceiver.currentDirection !== 'sendrecv') {
                transceiver.stop();
            }
            await signalOffer(await createOffer());
            streamRegistry = omit([streamId], streamRegistry);
            peerEventsEmitter.emit(PEER_UPDATED_EVENT, streamRegistry);
            console.log(
                `Local transceivers list of peer ${peerId} after deleting downstream with id ${streamId}`,
                getTransceivers()
            );
        });
    }

    async function signalOffer(offer) {
        eventEmitter.emit('createOffer', {
            offer,
        });

        return new Promise((resolve) => {
            eventEmitter.once('createAnswer', async (answer) => {
                await handleRemoteAnswer(answer);
                resolve();
            });
        });
    }

    async function createOffer() {
        console.log(`Creating offer for peer ${peerId}`);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log(`Offer successfully createed for peer ${peerId}`, offer);
        return offer;
    }

    async function handleRemoteAnswer(answer) {
        await pc.setRemoteDescription(answer);
        console.log(
            `Answer received for the peer ${peerId} and successfully set as a remote description`,
            answer
        );
    }

    function getTransceivers() {
        return pc.getTransceivers();
    }

    function getStreams() {
        return streamRegistry;
    }

    function getRemoteDescription() {
        return pc.remoteDescription;
    }

    function getLocalDescription() {
        return pc.localDescription;
    }

    return connection;
};

export const createPeer = (gateway) => {
    const peerId = Date.now();
    const eventEmitter = new EventEmitter();
    const peerEventsEmitter = new EventEmitter();

    const connection = createConnection(
        gateway,
        eventEmitter,
        peerEventsEmitter,
        peerId
    );

    const peer = {
        peerId,
        on,
        publishVideo,
        unpublishVideo,
        connect,
        getStreams,
        getTransceivers,
        getLocalDescription,
        getRemoteDescription,
    };

    function connect() {
        return connection.connect();
    }

    function publishVideo(stream) {
        connection.publishVideo(stream);
    }

    function unpublishVideo() {
        connection.unpublishVideo();
    }

    function on(eventName, listener) {
        peerEventsEmitter.on(eventName, listener);
    }

    function getStreams() {
        return connection.getStreams();
    }

    function getTransceivers() {
        return connection.getTransceivers();
    }

    function getRemoteDescription() {
        return connection.getRemoteDescription();
    }

    function getLocalDescription() {
        return connection.getLocalDescription();
    }

    return peer;
};
