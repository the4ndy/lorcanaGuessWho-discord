import { Server } from '@robojs/server';
import { Server as SocketServer } from 'socket.io';
import fs from 'node:fs';

let cardsSummary = [];
const colorMap = { 1: "Amber", 2: "Amethyst", 4: "Emerald", 8: "Ruby", 16: "Sapphire", 32: "Steel" };

try {
    const rawCards = fs.readFileSync('./cards.json', 'utf8');
    const allCards = JSON.parse(rawCards);
    allCards.forEach(card => {
        if (!card.image_url) return;
        cardsSummary.push({
            id: card.id,
            name: card.name,
            title: card.title || '',
            cost: card.cost,
            type: card.type,
            rarity: card.rarity,
            ink: card.ink,
            lore: card.lore,
            strength: card.strength,
            willpower: card.willpower,
            setId: card.setId,
            color: colorMap[card.colorMask] || 'Unknown',
            image_url: card.image_url
        });
    });
    console.log(`Loaded ${cardsSummary.length} cards for Who Am I.`);
} catch (e) {
    console.error("Could not load cards.json", e);
}

export const getCards = () => cardsSummary;

export const games = {};

export default async () => {
    try {
        await Server.ready();
        const engine = Server.get();
        
        if (!engine) {
            console.error("Robo server not available yet!");
            return;
        }

        // Fastify engine has .server, standard node engine is just the engine
        const httpServer = engine.server || engine.getHttpServer?.() || engine;
        const io = new SocketServer(httpServer, { cors: { origin: "*" } });

        io.on('connection', (socket) => {
            socket.on('join_game', (data) => {
                const room = data.roomCode; // Activity Instance ID
                if (!games[room]) {
                    games[room] = {
                        players: {},
                        gamePhase: 'lobby',
                        cards: {},
                        winner: null
                    };
                }

                socket.join(room);
                games[room].players[data.id] = { name: data.name, avatar: data.avatar, socketId: socket.id, wins: 0 };
                io.to(room).emit('state_update', games[room]);
            });

            socket.on('rejoin', (data) => {
                const room = data.roomCode;
                if (games[room] && games[room].players[data.id]) {
                    socket.join(room);
                    games[room].players[data.id].socketId = socket.id;
                    socket.emit('state_update', games[room]);
                }
            });

            socket.on('start_game', (data) => {
                const room = data.roomCode;
                const game = games[room];
                if (game && game.gamePhase === 'lobby') {
                    const playerIds = Object.keys(game.players);
                    if (playerIds.length < 2) return socket.emit('error', 'Need at least 2 players to start.');

                    // Pick N random unique cards
                    let shuffled = [...cardsSummary].sort(() => 0.5 - Math.random());
                    playerIds.forEach((id, index) => {
                        game.cards[id] = shuffled[index];
                    });

                    game.gamePhase = 'active';
                    game.winner = null;
                    io.to(room).emit('state_update', game);
                }
            });

            socket.on('who_am_i_guess', (data) => {
                const room = data.roomCode;
                const game = games[room];
                if (game && game.gamePhase === 'active') {
                    const myCard = game.cards[data.playerId];
                    if (myCard && myCard.id === data.guessCardId) {
                        game.gamePhase = 'game_over';
                        game.winner = data.playerId;
                        if (game.players[data.playerId]) {
                            game.players[data.playerId].wins = (game.players[data.playerId].wins || 0) + 1;
                        }
                        io.to(room).emit('state_update', game);
                    } else {
                        socket.emit('wrong_guess', data.guessCardId);
                    }
                }
            });

            socket.on('play_again', (data) => {
                const room = data.roomCode;
                const game = games[room];
                if (game) {
                    game.gamePhase = 'lobby';
                    game.cards = {};
                    game.winner = null;
                    io.to(room).emit('state_update', game);
                }
            });

            socket.on('disconnecting', () => {
                for (const room of socket.rooms) {
                    if (games[room]) {
                        // Check if this was the last person in the room
                        const numClients = io.sockets.adapter.rooms.get(room)?.size || 0;
                        if (numClients <= 1) {
                            // Everyone left, clean up game to reset scores
                            console.log(`Activity instance ${room} is empty, cleaning up.`);
                            delete games[room];
                        }
                    }
                }
            });
        });
        
        console.log("Socket.io initialized on Robo.js server.");
    } catch (error) {
        console.error("Error in _start.js:", error);
    }
};
