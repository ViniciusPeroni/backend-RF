const cron = require("node-cron");
// const cleanUpMessages = require("./services/");

cron.schedule("0 * * * sun", async() => {
    try {
        await cleanUpMessages();
    } catch (error) {
        console.error("Erro ao executar a Limpeza automática", error);
    }
});