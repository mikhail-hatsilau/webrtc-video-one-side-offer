const identifyNewColor = () => {
    const decrease = (px) => px - 1;
    const increase = (px) => px + 1;

    let strategy = decrease;

    return (pixel, max) => {
        const result = strategy(pixel);
        if (result < 0) {
            strategy = increase;
        }

        if (result > max) {
            strategy = decrease;
        }

        return strategy(pixel);
    };
};

const getRandomPixelColor = () => Math.random() * (255 - 1) + 1;

export const whiteNoise = (canvas) => {
    const ctx = canvas.getContext('2d');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const p = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const maxRandomColor = [
        getRandomPixelColor(),
        getRandomPixelColor(),
        getRandomPixelColor(),
    ];
    let randomColor = maxRandomColor;
    const identifyColor = identifyNewColor();
    requestAnimationFrame(function draw() {
        for (let i = 0; i < p.data.length; i++) {
            p.data[i++] = randomColor[0];
            p.data[i++] = randomColor[1];
            p.data[i++] = randomColor[2];
        }
        randomColor = [
            identifyColor(randomColor[0], maxRandomColor[0]),
            identifyColor(randomColor[1], maxRandomColor[1]),
            identifyColor(randomColor[2], maxRandomColor[2]),
        ];
        ctx.putImageData(p, 0, 0);
        requestAnimationFrame(draw);
    });
    return canvas;
};
