import { Server, Socket } from "socket.io";
import { Logger } from "@nestjs/common";
import {
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from "@nestjs/websockets";
import { JwtService } from "@nestjs/jwt";
import { ChatService } from "./chat.service";
import { ChatMethods } from "#constants";
import { RoomService } from "#room/room.service";

interface Message {
    /** 사용자 socket id */
    clientId: string;
    /** 사용자 이름 */
    name: string;
    /** 메시지 내용 */
    text: string;
    /** 채팅방 ID */
    chatRoomId: string;
    /** 메시지 전송 날자 (ISO String) */
    createdAt: string;
    /** 임의 데이터 전송용 */
    customData?: string;
}

@WebSocketGateway({ namespace: "chat", cors: true })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
    constructor(
        private jwtService: JwtService,
        private roomService: RoomService,
        private chatService: ChatService,
    ) {}
    private static readonly logger = new Logger(ChatGateway.name);

    @WebSocketServer()
    private server: Server;

    afterInit() {
        ChatGateway.logger.log("Socket Server Init Complete");
    }

    handleConnection(client: Socket) {
        ChatGateway.logger.log(`${client.id}(${client.handshake.query["username"]}) is connected!`);
    }

    handleDisconnect(client: Socket) {
        ChatGateway.logger.log(`${client.id} is disconnected...`);
    }

    @SubscribeMessage(ChatMethods.Connect)
    async handleConnect(client: Socket, { chatRoomId, name }: Pick<Message, "chatRoomId" | "name">) {
        const { token } = client.handshake.auth;

        if (!token) {
            client.emit(ChatMethods.Error, {
                message: "Invalid token",
            });
            return;
        }

        const { sub: userId } = await this.jwtService.verifyAsync(token, {
            secret: process.env.JWT_SECRET,
        });

        if (!userId) {
            client.emit(ChatMethods.Error, {
                message: "Invalid token",
            });
            return;
        }

        const targetRoom = await this.roomService.findOne(chatRoomId);

        if (targetRoom == null) {
            client.emit(ChatMethods.Error, {
                message: "Room doesn't exist",
            });
            return;
        }

        if (!targetRoom.users.find(({ user }) => user === userId)) {
            client.emit(ChatMethods.Error, {
                message: "You are not allowed to join this room",
            });
            return;
        }

        ChatGateway.logger.log(`${client.id} is joined to ${chatRoomId}`);
        client.data = {
            userId,
            name,
            token,
        };

        this.server.to(chatRoomId).emit(ChatMethods.ReceiveMessage, {
            name: "System",
            text: `Hurray! ${name} has been arrived.`,
        });
        client.join(chatRoomId);
        const chatData = await this.chatService.getRoomData(chatRoomId);
        client.emit(ChatMethods.FetchMessages, chatData.data);
    }

    @SubscribeMessage(ChatMethods.SendMessage)
    handleMessage(client: Socket, message: Message) {
        if (!client.data || typeof client.data !== "object") {
            client.emit(ChatMethods.Error, {
                message: "Invalid request",
            });
            return;
        }

        const { token, userId, name } = client.data;

        if (!token || !userId || !name) {
            client.emit(ChatMethods.Error, {
                message: "Invalid request",
            });
            return;
        }

        const createdAt = new Date().toISOString();
        const messageToSend: Message = {
            clientId: client.id,
            ...message,
            createdAt,
        };

        this.server.to(message.chatRoomId).emit(ChatMethods.ReceiveMessage, messageToSend);
        this.chatService.saveChatData({
            userId,
            chatRoomId: message.chatRoomId,
            name,
            text: message.text,
            createdAt,
        });
    }
}
