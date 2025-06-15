// ==UserScript==
// @name         Bilibili Sponsor Skip
// @namespace    https://harrynull.tech/
// @version      2025-06-15
// @description  Skip Bilibili sponsor segments.
// @description:zh-CN 跳过Bilibili赞助商广告片段。
// @author       harrynull
// @match        https://www.bilibili.com/video/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bilibili.com
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    var BASE_URL = "https://harrynull.tech/bilisponsor/";

    function log(...args) {
        console.log('%c[Bilibili Sponsor Skip Userscript]', 'background: #ffc0cb; color: #000', ...args);
    }

    var video = null;
    document.addEventListener("DOMContentLoaded", function () {
        video = document.getElementsByClassName("bpx-player-video-wrap")[0].getElementsByTagName("video")[0];
        if (!video) {
            log("Video element not found!");
            return;
        }
    });

    var adSegments = [];

    function addXMLRequestCallback(callback) {
        var oldOpen = XMLHttpRequest.prototype.open;
        var oldSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
            this._url = url; // Store the URL for later use
            oldOpen.apply(this, arguments);
            return this;
        }
        XMLHttpRequest.prototype.send = function () {
            this.addEventListener('readystatechange', function () {
                if (this.readyState === 4 && this.status === 200) {
                    callback(this, this._url);
                }
            })
            oldSend.apply(this, arguments);
            return this;
        }
    }

    async function calcSha256(str) {
        const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
        var hashArray = Array.from(new Uint8Array(hashBuffer)); // Convert buffer to byte array
        var sha256 = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // Convert bytes to hex string
        return sha256;
    }

    addXMLRequestCallback(function (xhr, url) {
        if (!url.startsWith("//api.bilibili.com/x/player/wbi/v2")) return;
        (async () => {
            try {
                var subtitleUrl = "https:" + JSON.parse(xhr.responseText).data.subtitle.subtitles[0].subtitle_url;
                log("Subtitle URL found:", subtitleUrl);
                const response = await fetch(subtitleUrl);
                const data = await response.text();
                const sha256 = await calcSha256(data);
                log("sha:", sha256);
                const cacheResponse = await fetch(BASE_URL + "ads/sha256/" + sha256);
                const cacheData = await cacheResponse.json();
                if (!cacheData.error) {
                    adSegments = cacheData.ads;
                    log("Ad segments loaded by cache:", adSegments);
                    return;
                } else {
                    log("cache not hit:", cacheData.error);
                }
                const postResponse = await fetch(BASE_URL + "ads/text", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: data,
                });
                const postData = await postResponse.json();
                if (postData.error) {
                    log("Error fetching ad segments:", postData.error);
                    return;
                }
                adSegments = postData.ads;
                log("Ad segments loaded:", adSegments);
            } catch (err) {
                log("Error in async subtitle/ad segment flow:", err);
            }
        })();
    });

    setInterval(function () {
        for (var segment of adSegments) {
            if (video.currentTime >= segment.start_time && video.currentTime <= segment.end_time) {
                log("Ad segment detected, skipping to the end.", segment);
                video.currentTime = segment.end_time;
                window.player.toast.create({ "text": "跳过广告：" + segment.topic });
                return;
            }
        }
    }, 500);

    log("Script loaded successfully!");
})();