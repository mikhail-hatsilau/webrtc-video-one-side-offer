import { render } from 'lit-html';
import 'webrtc-adapter';

import { createPeer, PEER_UPDATED_EVENT } from './peer.js';
import { createGateway } from './gateway.js';
import { createStreamRegistry } from './stream-registry.js';
import { renderPeersList } from './ui-components/peers-list';

const streamRegistry = createStreamRegistry();
const gateway = createGateway(streamRegistry);

const peers = [];

const onAddPeer = () => {
    const peer = createPeer(gateway);
    peers.push(peer);
    peer.connect();

    peer.on(PEER_UPDATED_EVENT, () => {
        render(renderPeersList({ peers, onAddPeer }), document.body);
    });

    render(renderPeersList({ peers, onAddPeer }), document.body);
};

render(renderPeersList({ peers, onAddPeer }), document.body);
