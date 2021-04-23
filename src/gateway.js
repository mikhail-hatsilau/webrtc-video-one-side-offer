import omit from 'lodash/fp/omit';
import values from 'lodash/fp/values';
import flow from 'lodash/fp/flow';
import filter from 'lodash/fp/filter';
import { rtcConfig } from './rtc-config.js';
import { DELETE_EVENT_NAME, ADD_EVENT_NAME } from './stream-registry.js';

const findTransceiverById = (transceivers, transceiverId) =>
    transceivers.find((transceiver) => transceiver.mid === transceiverId);

export const createConnection = (streamRegistry, eventEmitter, peerId) => {
    let streamTransceiverMap = {};
    let upstream;
    let downstreams = [];

    const pc = new RTCPeerConnection({
        iceServers: rtcConfig.iceServers,
    });

    pc.addEventListener('track', handleAddTrack);
    pc.addEventListener('icecandidate', handleLocalIceCandidate);

    streamRegistry.on(ADD_EVENT_NAME, handleDownstreamAdd);
    streamRegistry.on(DELETE_EVENT_NAME, handleDownstreamRemoved);

    eventEmitter.on('upstreamRemoved', handleUpstreamRemove);
    eventEmitter.on('createOffer', handleCreateOffer);
    eventEmitter.on('peerIceCandidate', handlePeerIceCandidate);

    const existingStreams = flow(
        values,
        filter((data) => typeof data !== 'function')
    )(streamRegistry);

    if (existingStreams.length) {
        existingStreams.forEach((streamData) => {
            addDownstream(streamData);
        });
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

    async function handleCreateOffer({ offer, transceiverId, streamId }) {
        await pc.setRemoteDescription(offer);

        if (!(transceiverId && streamId)) {
            await answer();
            console.log(
                `Gateway: local transceivers after answering to the peer ${peerId}`,
                pc.getTransceivers()
            );
            return;
        }

        const { stream } =
            downstreams.find(
                (downstream) => downstream.stream.id === streamId
            ) || {};

        if (!stream) {
            console.error(`Stream with ${streamId} was not announced`);
            return;
        }

        downstreams = downstreams.filter(
            (downstream) => downstream.stream.id !== streamId
        );

        const transceiver = findTransceiverById(
            pc.getTransceivers(),
            transceiverId
        );

        if (!transceiver) {
            console.error(
                `Local transceiver with id "${transceiverId}" can not be found`
            );
            return;
        }

        streamTransceiverMap = {
            ...streamTransceiverMap,
            [stream.id]: {
                stream,
                transceiver,
            },
        };

        await transceiver.sender.replaceTrack(stream.getTracks()[0]);
        transceiver.direction = 'sendrecv';

        await answer();
        console.log(
            `Gateway: local transceivers after adding track to the transceiver with id ${transceiverId} of peer ${peerId}`,
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

        const { transceiver } = streamTransceiverMap[streamId];
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
