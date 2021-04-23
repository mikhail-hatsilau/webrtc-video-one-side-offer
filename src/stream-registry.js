import EventEmitter from 'events';

export const ADD_EVENT_NAME = 'add';
export const DELETE_EVENT_NAME = 'delete';

export const createStreamRegistry = () => {
    const eventEmitter = new EventEmitter();

    const registry = {
        on(eventName, listener) {
            eventEmitter.on(eventName, listener);
        },
    };

    const handlers = {
        set(target, prop, value) {
            target[prop] = value;
            eventEmitter.emit(ADD_EVENT_NAME, { prop, value });
            return true;
        },
        deleteProperty(target, prop) {
            delete target[prop];
            eventEmitter.emit(DELETE_EVENT_NAME, { prop });
            return true;
        },
    };

    return new Proxy(registry, handlers);
};
