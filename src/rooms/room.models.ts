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
  id: string;
  name: string;

  constructor(id:string, name:string) {
    this.id = id;
    this.name = name;
  }
}

export class Song {
  key: string;
  title: string;
  downloadProgress: number;
  ready: boolean;
  durationInSeconds: number;
  /** Public ID of the user who requested it */
  requestedBy?: string;

  constructor(key: string, title: string, ready: boolean, durationInSeconds: number) {
    this.key = key;
    this.title = title;
    this.ready = ready;
    this.durationInSeconds = durationInSeconds;
    this.downloadProgress = 0;
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