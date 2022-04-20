import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {

  getHello(): any {
    return {
      info: 'SyncThat lmao!',
    };
  }

}
