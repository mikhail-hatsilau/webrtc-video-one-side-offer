import { html, nothing } from 'lit-html';

export const renderStreams = ({
    streams,
    upstreams,
    removeUpstream,
    addUpstream,
}) => {
    const handleVideoLoadedData = (event) => {
        event.target.play();
    };

    return html`
        ${streams.length === 0 && upstreams
            ? html`<button @click=${addUpstream}>Add upstream</button>`
            : nothing}
        <ul>
            ${streams.map(
                (stream) => html`
                    <li>
                        <div class="stream">
                            <video
                                .srcObject=${stream.stream}
                                @loadeddata=${handleVideoLoadedData}
                            ></video>
                            <span>${stream.peerId}</span>
                        </div>
                        ${upstreams
                            ? html`<button
                                  @click=${() =>
                                      removeUpstream(stream.stream.id)}
                              >
                                  Remove stream
                              </button>`
                            : nothing}
                    </li>
                `
            )}
        </ul>
    `;
};
