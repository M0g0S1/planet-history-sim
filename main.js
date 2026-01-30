const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

canvas.width = 800;
canvas.height = 400;

ctx.fillStyle = "#1e90ff";
ctx.fillRect(0, 0, canvas.width, canvas.height);

ctx.fillStyle = "#fff";
ctx.font = "20px sans-serif";
ctx.fillText("Map rendering online", 20, 40);
