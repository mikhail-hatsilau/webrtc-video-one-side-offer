# webrtc-video-one-side-offer

POC allows to add multiple peers with multiple video downstreams. POC uses webrtc with a specific configuration: offers are created only from the client side.
Transceivers can be dinamically added and reused during the session
See [Demo](https://jovial-jepsen-471df5.netlify.app/)

## Prerequisite
 - NodeJS version 14.x.x
 - npm version 6.x.x
## How to start

1. `npm install`
2. `npm start` - for starting watch mode and static server. If `npm start` command is used, then changes will be applied without manual rebuilding
