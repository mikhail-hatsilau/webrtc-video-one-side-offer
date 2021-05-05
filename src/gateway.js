import omit from 'lodash/fp/omit';
import values from 'lodash/fp/values';
import flow from 'lodash/fp/flow';
import find from 'lodash/fp/find';
import filter from 'lodash/fp/filter';
import { rtcConfig } from './rtc-config.js';
import { DELETE_EVENT_NAME, ADD_EVENT_NAME } from './stream-registry.js';

const getTransceivers = (pc) => pc.getTransceivers();

const findTransceiverById = (transceiverId, pc) =>
    flow(
        getTransceivers,
        find((transceiver) => transceiverId === transceiver.mid)
    )(pc);

const findTransceiverOfSender = (sender, pc) =>
    flow(
        getTransceivers,
        find((transceiver) => transceiver.sender === sender)
    )(pc);

export const createConnection = (streamRegistry, eventEmitter, peerId) => {
    let streamTransceiverMap = {};
    let upstream;
    let downstreams = [];

    const pc = new RTCPeerConnection({
        iceServers: rtcConfig.iceServers,
    });

    pc.addEventListener('track', handleAddTrack);
    pc.addEventListener('icecandidate', handleLocalIceCandidate);

    pc.addEventListener('negotiationneeded', () => {
        console.log('negotiation needed gateway');
    });

    notifyPeerDownstreamsExist(pc, streamRegistry);

    streamRegistry.on(ADD_EVENT_NAME, handleDownstreamAdd);
    streamRegistry.on(DELETE_EVENT_NAME, handleDownstreamRemoved);

    eventEmitter.on('upstreamRemoved', handleUpstreamRemove);
    eventEmitter.on('createOffer', handleCreateOffer);
    eventEmitter.on('peerIceCandidate', handlePeerIceCandidate);

    async function notifyPeerDownstreamsExist() {
        await new Promise((resolve) => {
            pc.addEventListener('signalingstatechange', () => {
                if (pc.signalingState === 'stable') {
                    resolve();
                }
            });
        });

        const existingStreams = flow(
            values,
            filter((data) => typeof data !== 'function')
        )(streamRegistry);
        if (existingStreams.length) {
            existingStreams.forEach((streamData) => {
                addDownstream(streamData);
            });
        }
    }

    function handlePeerIceCandidate(candidate) {
        pc.addIceCandidate(candidate);
    }

    function handleLocalIceCandidate({ candidate }) {
        if (!candidate) {
            return;
        }

        eventEmitter.emit('iceCandidate', candidate);
    }

    async function handleCreateOffer({ offer }) {
        await pc.setRemoteDescription(offer);

        if (!downstreams.length) {
            await answer();
            return;
        }

        const { stream } = downstreams.shift();

        const sender = pc.addTrack(stream.getTracks()[0], stream);
        const senderTransceiver = findTransceiverOfSender(sender, pc);

        streamTransceiverMap = {
            ...streamTransceiverMap,
            [stream.id]: {
                stream,
                transceiverId: senderTransceiver.mid,
            },
        };

        await answer();
        console.log(
            `Gateway: local transceivers after adding track to peer ${peerId}`,
            pc.getTransceivers()
        );
    }

    function handleAddTrack({ transceiver }) {
        upstream = new MediaStream([transceiver.receiver.track]);
        streamRegistry[upstream.id] = {
            stream: upstream,
            peerId,
        };
    }

    function handleUpstreamRemove() {
        delete streamRegistry[upstream.id];
        upstream = null;
    }

    function handleDownstreamAdd({ prop, value }) {
        if (!upstream || prop !== upstream.id) {
            addDownstream(value);
        }
    }

    function addDownstream(streamData) {
        downstreams.push(streamData);
        eventEmitter.emit('streamAdded', {
            streamId: streamData.stream.id,
            peerId: streamData.peerId,
        });
    }

    function handleDownstreamRemoved({ prop: streamId }) {
        if (!streamTransceiverMap[streamId]) {
            return;
        }

        const { transceiverId } = streamTransceiverMap[streamId];
        const transceiver = findTransceiverById(transceiverId, pc);
        pc.removeTrack(transceiver.sender);

        streamTransceiverMap = omit([streamId], streamTransceiverMap);

        console.log(`Gateway: downstream with id ${streamId} removed`);

        eventEmitter.emit('streamRemoved', streamId);
    }

    async function answer() {
        await pc.setLocalDescription(await pc.createAnswer());
        console.log(
            `Gateway: answert created and set for ${peerId}`,
            pc.localDescription
        );
        eventEmitter.emit('createAnswer', pc.localDescription);
    }
};

export const createGateway = (streamRegistry) => {
    const gateway = {
        connect,
    };

    function connect(peerId, eventEmitter) {
        createConnection(streamRegistry, eventEmitter, peerId);
    }

    return gateway;
};
