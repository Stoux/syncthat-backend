import {DownloadResult, YoutubeDlJsonDump} from "../songs/songs.service";

export class Room {

  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
    this._users = [];
    this.playlist = [];
    this.currentSong = null;
  }

  id: number;
  name: string;
  playlist: Song[];
  currentSong?: CurrentSong;
  private _users: RoomUser[]

  get users(): RoomUser[] {
    return this._users;
  }

  set users(value: RoomUser[]) {
    this._users = value;
  }
}

export class RoomUser {
  privateId: string;
  publicId: string;
  name: string;

  constructor(privateId: string, publicId: string, name: string) {
    this.privateId = privateId;
    this.publicId = publicId;
    this.name = name;
  }

  publicInfo() {
    return {
      id: this.publicId,
      name: this.name,
    }
  }

}

export class Song {
  key: string;
  title: string;
  downloadProgress: number;
  ready: boolean;
  durationInSeconds: number;
  waveformGenerated?: boolean;
  songInfo?: YoutubeDlJsonDump;
  likedDisliked: {  [key: string]: boolean };

  /** Public ID of the user who requested it */
  requestedBy?: string;
  requestedAt?: number;
  playedAt?: number;
  stoppedAt?: number;

  constructor(key: string, title: string, ready: boolean, durationInSeconds: number, waveformGenerated: boolean, songInfo?: YoutubeDlJsonDump, requestedBy?: string) {
    this.key = key;
    this.title = title;
    this.ready = ready;
    this.durationInSeconds = durationInSeconds;
    this.downloadProgress = ready ? 100 : 0;
    this.waveformGenerated = waveformGenerated;
    this.songInfo = songInfo;

    this.requestedBy = requestedBy;
    this.requestedAt = (new Date()).getTime();

    this.likedDisliked = {};


  }

}

export class CurrentSong {
  song: Song;
  playing: boolean;

  /** The last known 'current seconds' into the song at the moment of the event timestamp */
  lastCurrentSeconds: number;
  /** Epoch timestamp of the last song update */
  eventTimestamp: number;

  constructor(song: Song) {
    this.song = song;
    this.playing = true;
    this.lastCurrentSeconds = 0;
    this.eventTimestamp = (new Date()).getTime() + 1000;
  }

}

export enum LogMessageType {
  ChatMessage = 1,
  Notification = 2,
}

export interface LogMessage {
  id: string,
  type: LogMessageType;
  timestamp: number;
}

export interface LogChatMessage extends LogMessage {
  byId: string,
  name: string;
  message: string;
}

export interface LogNotification extends LogMessage {
  /** [highlighted] text */
  message: string;
  /** Type ID of the notification */
  notificationType: NotificationType;
  emoji?: string;
}

export enum NotificationType {
  PRIVATE_MESSAGE = -1,
  USER_JOIN = 1,
  USER_LEAVE = 2,
  USER_CHANGED_NAME = 3,
  SONG_ADDED_TO_QUEUE = 10,
  SONG_REMOVED_FROM_QUEUE = 11,
  SONG_QUEUE_MOVED = 12,
  SONG_FORCE_PLAYED = 15,
  SONG_VOTE_SKIPPED = 20,
}



