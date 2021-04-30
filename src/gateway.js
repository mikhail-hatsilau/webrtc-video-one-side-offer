import omit from 'lodash/fp/omit';
import values from 'lodash/fp/values';
import flow from 'lodash/fp/flow';
import filter from 'lodash/fp/filter';
import { rtcConfig } from './rtc-config.js';
import { DELETE_EVENT_NAME, ADD_EVENT_NAME } from './stream-registry.js';

const transceiverDesiredDirections = ['recvonly', 'inactive', 'sendrecv'];
const transceiverCurrentDirection = ['inactive', null];

const findInactiveTransceiver = (transceivers) =>
    transceivers.find(
        (transceiver) =>
            transceiverDesiredDirections.includes(transceiver.direction) &&
            transceiverCurrentDirection.includes(transceiver.currentDirection)
    );

export const createConnection = (streamRegistry, eventEmitter, peerId) => {
    let streamTransceiverMap = {};
    let upstream;
    let downstreams = [];

    const pc = new RTCPeerConnection({
        iceServers: rtcConfig.iceServers,
    });

    pc.addEventListener('track', handleAddTrack);
    pc.addEventListener('icecandidate', handleLocalIceCandidate);

    notifyPeerDownstreamsExist(pc, streamRegistry);

    streamRegistry.on(ADD_EVENT_NAME, handleDownstreamAdd);
    streamRegistry.on(DELETE_EVENT_NAME, handleDownstreamRemoved);

    eventEmitter.on('upstreamRemoved', handleUpstreamRemove);
    eventEmitter.on('createOffer', handleCreateOffer);
    eventEmitter.on('peerIceCandidate', handlePeerIceCandidate);

    async function notifyPeerDownstreamsExist() {
        await new Promise((resolve) => {
            pc.addEventListener('connectionstatechange', () => {
                if (pc.connectionState === 'connected') {
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

        const transceiver = findInactiveTransceiver(pc.getTransceivers());

        streamTransceiverMap = {
            ...streamTransceiverMap,
            [stream.id]: {
                stream,
                transceiverId: transceiver.mid,
            },
        };

        await transceiver.sender.replaceTrack(stream.getTracks()[0]);
        transceiver.direction = 'sendrecv';

        await answer();
        console.log(
            `Gateway: local transceivers after adding track to the transceiver with id ${transceiver.mid} of peer ${peerId}`,
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
        const transceiver = pc
            .getTransceivers()
            .find(({ mid }) => mid === transceiverId);
        transceiver.sender.replaceTrack(null);
        transceiver.direction = 'recvonly';

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
