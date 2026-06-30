import { GatewayIntentBits } from 'discord.js';

export default {
    clientOptions: {
        intents: [
            GatewayIntentBits.Guilds
        ]
    },
    plugins: [
        '@robojs/server'
    ]
};
