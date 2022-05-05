
/**
 * Join a room message.
 */
export interface Join {
    room: number;
    name?: string;
    privateId?: string;
}

export interface AddSong {
    url: string;
}

export interface SkipToTimestamp {
    toSeconds: number;
    atTimestamp?: number;
}

export interface Notice {
    message: string;
    type?: string;
}

export interface ChatMessage {
    user: string;
    message: string;
}