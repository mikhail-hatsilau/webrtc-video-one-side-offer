import { html } from 'lit-html';
import { PEER_UPDATED_EVENT } from '../peer';
import { renderPeer } from './peer';

export const renderPeersList = ({ peers, onAddPeer }) => {
    return html`
        <h2>Peers</h2>
        <button @click=${onAddPeer}>Add peer</button>
        <ul>
            ${peers.map((peer) => renderPeer(peer))}
        </ul>
    `;
};
