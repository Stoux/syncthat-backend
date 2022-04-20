export class Room {

  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
    this._users = [];
  }

  id: number;
  name: string;
  private _users: RoomUser[]

  get users(): RoomUser[] {
    return this._users;
  }

  set users(value: RoomUser[]) {
    this._users = value;
  }
}

export class RoomUser {
  id: number;
  name: string;

  constructor(id:number, name:string) {
    this.id = id;
    this.name = name;
  }
}