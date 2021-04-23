import { html, nothing } from 'lit-html';

export const renderStreams = ({
    streams,
    upstreams,
    removeUpstream,
    addUpstream,
}) => html`
    ${streams.length === 0 && upstreams
        ? html`<button @click=${addUpstream}>Add upstream</button>`
        : nothing}
    <ul>
        ${streams.map(
            (stream) => html`
                <li>
                    <video .srcObject=${stream.stream} autoplay></video>
                    ${upstreams
                        ? html`<button
                              @click=${() => removeUpstream(stream.stream.id)}
                          >
                              Remove stream
                          </button>`
                        : nothing}
                </li>
            `
        )}
    </ul>
`;
