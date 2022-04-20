import { Injectable } from '@nestjs/common';

@Injectable()
export class UserService {

  id: number;
//  users: User[];

  users: any[] = [
    {
      id: 1,
      name: "lmao"
    }
  ]

  getUsers(): any {
    return this.users;
  }

  addUser(name:string): any {
    return true;
  }
}