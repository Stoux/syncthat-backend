import {Body, Controller, Get, HttpException, Param, Post} from '@nestjs/common';
import {Room, RoomUser, Song} from './room.models';
import {RoomService} from "./room.service";
import { Logger } from '@nestjs/common';
import {DownloadResult, SongsService} from "../songs/songs.service";

@Controller('rooms')
export class RoomController {
  constructor(private readonly roomService: RoomService,private readonly songsService: SongsService ) {}

  @Get()
  getRooms(): string {
      return this.roomService.getRooms();
  }

  @Get(":id")
  getRoom(@Param('id') id:number ) : Room{
      const room = this.roomService.getRoomById(id);
      if(!room){
        throw new HttpException("No room found", 404);
      }else{
        return room;
      }
  }

  @Get('users')
  getUsers(): RoomUser[] {
      return this.roomService.getUsersForRoom(1);
  }

  @Post(':id/add-user')
  addUser(@Param('id') id:number): RoomUser {
    this.getRoom(id);
    return this.roomService.addUserToRoom(id, this.generateDutchName());
  }

  @Post(':id/add-song')
  addSong(@Param('id') id:number, @Body('url') url: string): Song {
    this.getRoom(id);
    const result = this.songsService.downloadSong(url);
    if(!result.success){
      throw new HttpException("Error trying to download song", 400);
    }
    const newSong = new Song(result.key, result.title, result.progress == 100, result.duration);
    return this.roomService.addSongToRoom(id, newSong);
  }

  generateDutchName() : string{
    const namen = {	"male": {		"first": [			"Bas",	"Martijn", "Storm", "Michael",			"Daan",			"Sem",			"Thomas",			"Tim",			"Lucas",			"Lars",			"Milan",			"Thijs",			"Jesse",			"Ruben",			"Stijn",			"Bram",			"Luuk",			"Sven",			"Max",			"Finn",			"Niels",			"Nick",			"Michaël",			"Sam",			"Tom",			"Jan",			"Julian",			"Jasper",			"Daniël",			"Gijs",			"Levi",			"Koen",			"Dylan",			"Mees",			"Luca",			"Noah",			"Robin",			"Justin",			"Bas",			"Stan",			"Teun",			"David",			"Tijn",			"Johannes",			"Rick",			"Floris",			"Thijmen",			"Mike",			"Ryan",			"Willem",			"Jelle",			"Jens",			"Cas",			"Kevin"		]},	"female": {		"first": [			"Sanne",			"Julia",			"Emma",			"Sophie",			"Lisa",			"Lotte",			"Anna",			"Eva",			"Fleur",			"Anne",			"Isa",			"Lieke",			"Iris",			"Noa",			"Femke",			"Anouk",			"Amber",			"Britt",			"Maud",			"Roos",			"Sara",			"Naomi",			"Nina",			"Jasmijn",			"Zoë",			"Laura",			"Tessa",			"Floor",			"Tess",			"Sarah",			"Marit",			"Lynn",			"Luna",			"Demi",			"Eline",			"Maria",			"Romy",			"Kim",			"Nienke",			"Ilse",			"Esmee",	"Vlinder", 		"Amy",			"Merel",			"Nikki",			"Charlotte",			"Indy",			"Vera",			"Sterre",			"Noor",			"Senna"		]	},	"unisex": {		"first": [			"Charlie",			"Robin",			"Rowan",			"Chris",			"Lieve",			"Max",			"Sam",			"Nicky",			"Pascal",			"Daan",			"Marijn",			"Alex",			"Sanne",			"Bobby",			"Anne",			"Lou",			"Jip",			"Dani",			"Beau",			"Marijn",			"Demi",			"Kim",			"Merle",			"Bowie",			"Jesse"		]	},	"last": [		"de Jong",		"Jansen",		"de Vries",		"van den Berg",		"van Dijk",		"Bakker",		"Janssen",		"Visser",		"Smit",		"Meijer",		"de Boer",		"Mulder",		"de Groot",		"Bos",		"Vos",		"Peters",		"Hendriks",		"van Leeuwen",		"Dekker",		"Brouwer",		"de Wit",		"Dijkstra",		"Smits",		"de Graaf",		"van der Meer",		"van der Linden",		"Kok",		"Jacobs",		"de Haan",		"Vermeulen",		"van den Heuvel",		"van der Veen",		"van den Broek",		"de Bruijn",		"de Bruin",		"van der Heijden",		"Schouten",		"van Beek",		"Willems",		"van Vliet",		"van de Ven",		"Hoekstra",		"Maas",		"Verhoeven",		"Koster",		"van Dam",		"van der Wal",		"Prins",		"Blom",		"Huisman",		"Peeters",		"de Jonge",		"Kuipers",		"van Veen",		"Post",		"Kuiper",		"Veenstra",		"Kramer",		"van den Brink",		"Scholten",		"van Wijk",		"Postma",		"Martens",		"Vink",		"de Ruiter",		"Timmermans",		"Groen",		"Gerritsen",		"Jonker",		"van Loon",		"Boer",		"van der Velde",		"Willemsen",		"Smeets",		"de Lange",		"de Vos",		"Bosch",		"van Dongen",		"Schipper",		"de Koning",		"van der Laan",		"Koning",		"van der Velden",		"Driessen",		"van Doorn",		"Hermans",		"Evers",		"van den Bosch",		"van der Meulen",		"Hofman",		"Bosman",		"Wolters",		"Sanders",		"van der Horst",		"Mol",		"Kuijpers",		"Molenaar",		"van de Pol",		"de Leeuw",		"Verbeek",		"van de Berg",		"van der Berg",		"Meyer",		"van de Meer",		"van den Pol",		"van der Pol",		"Kuypers",		"van de Velden",		"van den Velden",		"van den Velde",		"van de Velde",		"van der Ven",		"van de Veen",  "Stam", 	"van der Heyden",		"van de Brink",		"van de Wal",		"de Bruyn"	]};
    var genders = ['male', 'female', 'unisex'];

    var gender = genders[(Math.random() * genders.length) | 0]

    let firstPart = namen[gender]['first'];
    var firstName = firstPart[Math.round(Math.random() * (firstPart.length - 1))];

    let lastPart = namen['last'];
    var lastName = lastPart[Math.round(Math.random() * (lastPart.length - 1))];

    Logger.log(firstName + " " + lastName);
    return firstName + " " + lastName;
  }


}
