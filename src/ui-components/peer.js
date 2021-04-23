import { html } from 'lit-html';
import { whiteNoise } from '../generate-white-noize';
import { renderStreams } from './streams';
import { renderDescription } from './description';

export const renderPeer = (peer) => {
    const streams = Object.values(peer.getStreams());

    const handleRemoveUpstream = () => {
        peer.unpublishVideo();
    };

    const handleAddUpstream = () => {
        peer.publishVideo(
            whiteNoise(document.createElement('canvas')).captureStream()
        );
    };

    const downstreams = streams.filter((stream) => stream.direction === 'down');
    const upstreams = streams.filter((stream) => stream.direction === 'up');

    return html`
        <li>
            <h3>Peer ${peer.peerId}</h3>
            ${renderDescription({
                local: peer.getLocalDescription(),
                remote: peer.getRemoteDescription(),
            })}
            <h4>Upstreams</h4>
            ${renderStreams({
                streams: upstreams,
                upstreams: true,
                removeUpstream: handleRemoveUpstream,
                addUpstream: handleAddUpstream,
            })}

            <h4>Downstreams</h4>
            ${renderStreams({
                streams: downstreams,
            })}
        </li>
    `;
};
