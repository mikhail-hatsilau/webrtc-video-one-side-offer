import { html } from 'lit-html';

export const renderDescription = ({ local, remote }) => {
    return html`
        <details>
            <summary>Local sdp</summary>
            <p>${local && local.sdp}</p>
        </details>
        <details>
            <summary>Remote sdp</summary>
            <p>${remote && remote.sdp}</p>
        </details>
    `;
};
