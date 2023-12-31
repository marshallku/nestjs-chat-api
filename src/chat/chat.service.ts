import { Model, Types } from "mongoose";
import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Chat, ChatRoom } from "./chat.schema";
import { CHAT_DATA_CONNECTION_NAME, CHAT_DATA_LIMIT } from "#constants";

@Injectable()
export class ChatService {
    constructor(
        @InjectModel(ChatRoom.name, CHAT_DATA_CONNECTION_NAME) private chatRoomModel: Model<ChatRoom>,
        @InjectModel(Chat.name, CHAT_DATA_CONNECTION_NAME) private chatModel: Model<Chat>,
    ) {}

    async getRoomData(chatRoomId: string) {
        return await this.chatRoomModel
            .findOne({ chatRoomId }, { data: { $slice: -CHAT_DATA_LIMIT } })
            .populate({ path: "data" })
            .exec();
    }

    async getPreviousChatData(chatRoomId: string, chatId: string) {
        const { data } = await this.chatRoomModel
            .findOne({ chatRoomId })
            .populate({
                path: "data",
                match: { _id: { $lt: new Types.ObjectId(chatId) } },
                options: { sort: { _id: -1 }, limit: CHAT_DATA_LIMIT },
            })
            .exec();

        return data.reverse();
    }

    async saveChatData(chatData: Chat) {
        const chat = new this.chatModel(chatData);
        const data = await this.getRoomData(chat.chatRoomId);

        await chat.save();

        if (data == null) {
            const newChatRoom = new this.chatRoomModel({
                chatRoomId: chat.chatRoomId,
                data: [chat._id],
            });

            await newChatRoom.save();
            return chat;
        }

        await this.chatRoomModel.findOneAndUpdate({ chatRoomId: chatData.chatRoomId }, { $push: { data: chat._id } });

        return chat;
    }
}
