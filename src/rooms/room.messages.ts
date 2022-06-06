
/**
 * Join a room message.
 */
export interface Join {
    room: number;
    name?: string;
    emoji?: string;
    privateId?: string;
}

export interface AddSong {
    url: string;
}

export interface SkipToTimestamp {
    toSeconds: number;
    atTimestamp?: number;
}

export interface ChangeSongQueuePosition {
    key: string,
    position: number,
}

export interface ChatMessage {
    message: string,
}

export interface VoteOnCurrentSong {
    vote: boolean|undefined,
}

export interface ChangeName {
    name: string,
}

export interface BecomeAdmin {
    password: string;
}

export interface Notice {
    message: string;
    type?: string;
}

export interface ChatMessage {
    user: string;
    message: string;
}