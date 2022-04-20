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
  ready: boolean;
  durationInSeconds: number;

  constructor(key: string, title: string, ready: boolean, durationInSeconds: number) {
    this.key = key;
    this.title = title;
    this.ready = ready;
    this.durationInSeconds = durationInSeconds;
  }
}

export class CurrentSong {
  song: Song;
  playing: boolean;
  songTimestamp: number;
  songAt: number;

  constructor() {

  }
}