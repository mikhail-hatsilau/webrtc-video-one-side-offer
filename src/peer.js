import EventEmitter from 'events';
import flow from 'lodash/fp/flow';
import entries from 'lodash/fp/entries';
import fromPairs from 'lodash/fp/fromPairs';
import map from 'lodash/fp/map';
import omitBy from 'lodash/fp/omitBy';
import omit from 'lodash/fp/omit';
import PQueue from 'p-queue';
import { rtcConfig } from './rtc-config.js';

const transceiverDesiredDirections = ['recvonly', 'sendrecv'];
const transceiverCurrentDirection = ['inactive'];

export const PEER_UPDATED_EVENT = 'peerUpdated';

const findInactiveTransceiver = (transceivers) =>
    transceivers.find(
        (transceiver) =>
            transceiverDesiredDirections.includes(transceiver.direction) &&
            transceiverCurrentDirection.includes(transceiver.currentDirection)
    );

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
    eventEmitter.on('iceCandidate', handleRemoteIceCandidate);
    eventEmitter.on('streamAdded', handleRemoteStreamAdded);
    eventEmitter.on('streamRemoved', handleStreamRemoved);

    // pc.addEventListener('connectionstatechange', handleConnectStateChange);

    const upstreamTransceiver = pc.addTransceiver('video', {
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
            await signalOffer(await createOffer());

            return new Promise((resolve) => {
                pc.addEventListener('connectionstatechange', () => {
                    if (pc.connectionState === 'connected') {
                        resolve();
                    }
                });
            });
        });
        gateway.connect(peerId, eventEmitter);
    }

    async function publishVideo(stream) {
        console.log(`Publish upstream for peer ${peerId}`);
        tasksQueue.add(async () => {
            upstreamTransceiver.sender.replaceTrack(stream.getTracks()[0]);
            upstreamTransceiver.direction = 'sendrecv';

            streamRegistry = {
                ...streamRegistry,
                [stream.id]: {
                    stream,
                    transceiverId: upstreamTransceiver.mid,
                    peerId,
                    direction: 'up',
                },
            };
            peerEventsEmitter.emit(PEER_UPDATED_EVENT, streamRegistry);

            await signalOffer(await createOffer());

            console.log(
                `Local transceivers list of the peer ${peerId} after successfull blishing upstream`,
                getTransceivers()
            );
        });
    }

    function unpublishVideo() {
        console.log(`Unpublish upstream of the peer ${peerId}`);
        streamRegistry = omitBy(
            (streamData) => streamData.direction === 'up',
            streamRegistry
        );
        peerEventsEmitter.emit(PEER_UPDATED_EVENT, streamRegistry);
        eventEmitter.emit('upstreamRemoved');
        tasksQueue.add(async () => {
            upstreamTransceiver.sender.replaceTrack(null);
            upstreamTransceiver.direction = 'recvonly';

            await signalOffer(await createOffer());

            console.log(
                `Local transceivers list of the peer ${peerId} after successfull unblishing upstream`,
                getTransceivers()
            );
        });
    }

    function handleRemoteIceCandidate(candidate) {
        pc.addIceCandidate(candidate);
    }

    function handleAddTrack({ transceiver }) {
        const assignTrackToStream = flow(
            entries,
            map((stream) => {
                const [streamId, streamData] = stream;
                if (streamData.transceiverId === transceiver.mid) {
                    return [
                        streamId,
                        {
                            ...streamData,
                            stream: new MediaStream([
                                transceiver.receiver.track, // { [streamId]: { stream: MediaStream, peerId: 123, transceiverId: '0' } }
                            ]),
                        },
                    ];
                }

                return stream;
            }),
            fromPairs
        );
        streamRegistry = assignTrackToStream(streamRegistry);
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

            let inactiveTransceiver = findInactiveTransceiver(
                pc.getTransceivers()
            );

            if (!inactiveTransceiver) {
                inactiveTransceiver = pc.addTransceiver('video', {
                    direction: 'recvonly',
                });
                console.log(
                    `There are no inactive transceivers for peer ${peerId}. Adding new one`,
                    inactiveTransceiver
                );
            } else {
                console.log(
                    `Found existing inactive transceiver for peer ${peerId}`,
                    inactiveTransceiver
                );
            }

            const offer = await createOffer();

            streamRegistry = {
                ...streamRegistry,
                [streamId]: {
                    stream: null,
                    transceiverId: inactiveTransceiver.mid,
                    peerId: remotePeerId,
                    direction: 'down',
                },
            };

            await signalOffer(offer, {
                transceiverId: inactiveTransceiver.mid,
                streamId,
            });

            console.log(
                `Local transceivers list of peer ${peerId} after adding downstream`,
                getTransceivers()
            );
        });
    }

    function handleStreamRemoved(streamId) {
        console.log(`Removing downstream ${streamId} for peer ${peerId}`);
        streamRegistry = omit([streamId], streamRegistry);
        peerEventsEmitter.emit(PEER_UPDATED_EVENT, streamRegistry);
        tasksQueue.add(async () => {
            await signalOffer(await createOffer());
            console.log(
                `Local transceivers list of peer ${peerId} after deleting downstream with id ${streamId}`,
                getTransceivers()
            );
        });
    }

    async function signalOffer(offer, additionalParams) {
        eventEmitter.emit('createOffer', {
            offer,
            ...additionalParams,
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
