const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

function prepareAvatar() {
    const targetPng = path.resolve(__dirname, "bot-avatar.png");
    if (fs.existsSync(targetPng) && fs.statSync(targetPng).size > 1000) {
        return true;
    }
    
    const candidateImagePaths = [
        "C:/Users/HP/.gemini/antigravity-ide/brain/70acc569-7765-48f4-a825-62c98ed3d605/bot_avatar_1789903250527.jpg",
        path.join(os.homedir(), ".gemini", "antigravity-ide", "brain", "70acc569-7765-48f4-a825-62c98ed3d605", "bot_avatar_1789903250527.jpg")
    ];

    const candidateVideoPaths = [
        "C:/Users/HP/Downloads/preabchey_ssspin.io_1789902985.mp4",
        path.join(os.homedir(), "Downloads", "preabchey_ssspin.io_1789902985.mp4"),
        path.resolve(__dirname, "..", "preabchey_ssspin.io_1789902985.mp4"),
        path.resolve(__dirname, "preabchey_ssspin.io_1789902985.mp4")
    ];

    const foundVideo = candidateVideoPaths.find(p => fs.existsSync(p));
    if (foundVideo) {
        let ffmpegBinary = null;
        try {
            ffmpegBinary = require("ffmpeg-static");
        } catch (e) {
            ffmpegBinary = null;
        }

        if (!ffmpegBinary || !fs.existsSync(ffmpegBinary)) {
            ffmpegBinary = "ffmpeg";
        }

        try {
            console.log(`🖼️ Extracting frame from video ${foundVideo} to ${targetPng}...`);
            const args = [
                "-y",
                "-ss", "00:00:01",
                "-i", foundVideo,
                "-frames:v", "1",
                "-update", "1",
                "-vf", "scale=512:512:force_original_aspect_ratio=increase,crop=512:512",
                targetPng
            ];
            const res = spawnSync(ffmpegBinary, args, { stdio: "inherit" });
            if (res.status === 0 && fs.existsSync(targetPng)) {
                console.log(`✅ Successfully replaced bot-avatar.png with new avatar from video!`);
                return true;
            }
        } catch (err) {
            console.warn(`⚠️ FFmpeg extraction note: ${err.message}`);
        }
    }

    const foundImage = candidateImagePaths.find(p => fs.existsSync(p));
    if (foundImage && (!fs.existsSync(targetPng) || fs.statSync(targetPng).size === 0)) {
        try {
            fs.copyFileSync(foundImage, targetPng);
            console.log(`✅ Set bot-avatar.png from asset!`);
            return true;
        } catch (err) {
            console.warn(`⚠️ Could not copy generated image: ${err.message}`);
        }
    }

    return fs.existsSync(targetPng);
}

function prepareBanner() {
    const targetPng = path.resolve(__dirname, "bot-banner.png");
    const oldGif = path.resolve(__dirname, "bot-banner.gif");

    // Remove old banner GIF if present
    if (fs.existsSync(oldGif)) {
        try {
            fs.unlinkSync(oldGif);
            console.log(`🗑️ Removed old banner GIF: ${oldGif}`);
        } catch (e) {
            console.warn(`⚠️ Could not delete old bot-banner.gif: ${e.message}`);
        }
    }

    // Check Downloads directory for exact user banner image files
    const downloadsDir = path.join(os.homedir(), "Downloads");
    const candidateBannerPaths = [
        path.join(downloadsDir, "bot-banner.png"),
        path.join(downloadsDir, "bot-banner.jpg"),
        path.join(downloadsDir, "banner.png"),
        path.join(downloadsDir, "banner.jpg"),
        path.join(downloadsDir, "krishna.png"),
        path.join(downloadsDir, "krishna.jpg"),
        "C:/Users/HP/.gemini/antigravity-ide/brain/70acc569-7765-48f4-a825-62c98ed3d605/krishna_banner_1789905013813.jpg"
    ];

    // If bot-banner.png already exists and is a valid custom file, keep it untouched
    if (fs.existsSync(targetPng) && fs.statSync(targetPng).size > 1000) {
        return true;
    }

    const foundBanner = candidateBannerPaths.find(p => fs.existsSync(p));
    if (foundBanner) {
        try {
            fs.copyFileSync(foundBanner, targetPng);
            console.log(`✅ Successfully set bot-banner.png from: ${foundBanner}`);
            return true;
        } catch (err) {
            console.warn(`⚠️ Could not copy banner image: ${err.message}`);
        }
    }

    return fs.existsSync(targetPng);
}

function prepareAllAssets() {
    prepareAvatar();
    prepareBanner();
}

if (require.main === module) {
    prepareAllAssets();
}

module.exports = { prepareAvatar, prepareBanner, prepareAllAssets, convertAvatar: prepareAllAssets };
