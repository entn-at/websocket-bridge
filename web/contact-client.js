/**
 * Copyright 2020 NVIDIA Corporation. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const id = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
const resampleWorker = './resampler.js';
var peer;
var username = 'Test_speaker_' + id.toString();
var peer_username;
var localStream;
var sampleRate;
var jarvisRunning = false;

var displacy;
var latencyTimer;
var scrollToBottomTime = 500;
var muted = false;


var websocket;

// ---------------------------------------------------------------------------------------
// Latency tracking
// ---------------------------------------------------------------------------------------
class LatencyTimer {
    constructor() {
        this.startTimes = new Array();
        this.latencies = new Array();
    }

    start(data = null) {
        return this.startTimes.push({ start: performance.now(), data: data }) - 1;
    }

    end(index) {
        if (index >= this.startTimes.length) {
            return 0;
        }
        var latency = Math.round(performance.now() - this.startTimes[index].start);
        this.latencies.push(latency);
        return { latency: latency, data: this.startTimes[index].data };
    }

    average() {
        const sum = this.latencies.reduce((a, b) => a + b, 0);
        return Math.round((sum / this.latencies.length) || 0);
    }
}

// ---------------------------------------------------------------------------------------
// Start Jarvis, whether triggered locally or by a message from peer
// ---------------------------------------------------------------------------------------
function startJarvisService() {
    if (jarvisRunning) {
        return;
    }
    document.getElementById('jarvis-btn').disabled = true;
    document.getElementById('jarvis-btn-stop').removeAttribute("disabled");
    latencyTimer = new LatencyTimer();

    if (websocket == null || websocket.readyState !== WebSocket.OPEN) {
        websocket = new WebSocket('wss://localhost:8009/');

        let audioInput = audio_context.createMediaStreamSource(localStream);
        let bufferSize = 4096;
        let recorder = audio_context.createScriptProcessor(bufferSize, 1, 1);

        websocket.addEventListener('open', function (evt) {
            console.log('WebSocket Client Connected');
            start_asr = { "type": "start", "language": "en-US", "format": "raw", "encoding": "LINEAR16", "sampleRateHz": 16000 };
            console.log(JSON.stringify(start_asr));
            websocket.send(JSON.stringify(start_asr));
        });

        websocket.addEventListener('close', function (result) {
            console.log("Web socket closed: '" + JSON.stringify(result) + "'");
            audioInput.disconnect();
            recorder.disconnect();
            jarvisRunning = false;
            //websocket.close();
        });

        websocket.addEventListener('error', function (err) {
            bootbox.alert(err.message).find(".bootbox-close-button").addClass("float-end");
            console.error(err.message);
        });

        // Transcription results streaming back from Jarvis
        websocket.addEventListener('message', function (result) {
            result_data = JSON.parse(result.data);

            if (result_data.type === "started") {
                // Start ASR streaming

                let worker = new Worker(resampleWorker);
                worker.postMessage({
                    command: 'init',
                    config: {
                        sampleRate: sampleRate,
                        outputSampleRate: 16000
                    }
                });

                // Use a worker thread to resample the audio, then send to server
                recorder.onaudioprocess = function (audioProcessingEvent) {
                    let inputBuffer = audioProcessingEvent.inputBuffer;
                    worker.postMessage({
                        command: 'convert',
                        // We only need the first channel
                        buffer: inputBuffer.getChannelData(0)
                    });
                    worker.onmessage = function (msg) {
                        if (msg.data.command == 'newBuffer') {
                            if (websocket.readyState === WebSocket.OPEN) {
                                websocket.send(msg.data.resampled.buffer);
                            }
                        }
                    };
                };

                // connect stream to our recorder
                audioInput.connect(recorder);
                // connect our recorder to the previous destination
                recorder.connect(audio_context.destination);
                jarvisRunning = true;

                console.log('Streaming audio to server');

                document.getElementById('input_field').setAttribute('placeholder', 'Enter some text to annotate, or start speaking');
                var connArea = document.getElementById('connection_status');
                toastr.success('Jarvis is connected.');
            }
            else if (result_data.type === "end") {
                console.log(result.data);
                return;
            }
            else if (result_data === undefined || result_data.alternatives === undefined) {
                return;
            }
            else {
                document.getElementById('input_field').value = result_data.alternatives[0].text;
                if (result_data.type === "recognition") {
                    // Erase input field
                    $('#input_field').val('');
                    showASRTranscript(username, "", result_data.alternatives[0].text);
                    if (result.latencyIndex !== undefined) {
                        var latencyResult = latencyTimer.end(result.latencyIndex);
                        console.log(latencyResult.data.name + ': ' + latencyResult.latency.toString() + ' ms');
                        console.log('Average latency (overall): ' + latencyTimer.average().toString() + ' ms');
                    }
                }
            }
        });
    }


}

function stopJarvisService() {
    console.log("Stop ASR websocket connection");
    document.getElementById('jarvis-btn-stop').disabled = true;
    document.getElementById('jarvis-btn').removeAttribute("disabled");
    if (websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ "type": "stop" }));
    }
    jarvisRunning = false;
}

// ---------------------------------------------------------------------------------------
// Shows ASR transcript
// ---------------------------------------------------------------------------------------
function showASRTranscript(speaker, annotations, text) {

    //if(!annotations)
    //    return;

    var nameContainer = document.createElement('div');
    var textContainer = document.createElement('p');
    if (speaker == username) {
        nameContainer.setAttribute('class', 'd-flex justify-content-end');
        nameContainer.innerHTML = "<p class=\"speaker-self mb-0 mt-1\"><small><strong>" + speaker + ":</strong></small></p>";
        textContainer.setAttribute('align', 'right');
    } else {
        nameContainer.innerHTML = "<p class=\"speaker-other mb-0 mt-1\"><small><strong>" + speaker + ":</strong></small></p>";
    }

    //displacy.render(textContainer, text, annotations.ner, annotations.ents);
    textContainer.innerHTML = "<p>" + text + "</p>";

    $("#transcription_area").append(nameContainer);
    $("#transcription_area").append(textContainer);
    $("#transcription_card").animate({ scrollTop: 100000 }, scrollToBottomTime);

    // Activate tooltips
    $("#transcription_area").tooltip({ selector: '[data-toggle=tooltip]' });
}

/**
 * Starts the request of the microphone
 *
 * @param {Object} callbacks
 */
function requestLocalAudio(callbacks) {
    // Monkeypatch for crossbrowser getUserMedia
    navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

    // Request audio and video
    // Try getting video, if it fails then go for audio only
    navigator.getUserMedia({ audio: true, video: false }, callbacks.success,
        function () { // error -- can't access video. Try audio only
            navigator.getUserMedia({ audio: true }, callbacks.success, callbacks.error);
        }
    );
}

$(document).ready(function () {
    // Activate tooltips
    $("body").tooltip({ selector: '[data-mdb-toggle=tooltip]' });

    // Start DisplaCy for the NER rendering
    //displacy = new displaCyENT('http://localhost:8000', {})

    /**
     * Request browser audio and video, and show the local stream
     */
    requestLocalAudio({
        success: function (stream) {
            localStream = stream;
            audio_context = new AudioContext();
            sampleRate = audio_context.sampleRate;
            console.log("Sample rate of local audio: " + sampleRate)
        },
        error: function (err) {
            bootbox.alert("Cannot get access to your microphone.")
                .find(".bootbox-close-button").addClass("float-end");
            console.error(err);
        }
    });

    // Allow us to launch Jarvis with only the local speaker
    document.getElementById('jarvis-btn').removeAttribute("disabled");
    document.getElementById('jarvis-btn-stop').disabled = true;

});

function setAudioEnabled(enabled) {
    if (!localStream) return;
    for (const track of localStream.getAudioTracks()) {
        track.enabled = enabled;
    }
}

// ---------------------------------------------------------------------------------------
// On clicking the Transcription button, start Jarvis
// ---------------------------------------------------------------------------------------
$(document).on("click", "#jarvis-btn", function (e) {
    startJarvisService();
});

$(document).on("click", "#jarvis-btn-stop", function (e) {
    stopJarvisService();
});

$(document).on("click", "#mute-btn", function (e) {
    if (!muted) {
        if ($(this).hasClass("btn-primary")) {
            $("#mute-btn").removeClass("btn-primary").addClass("btn-danger");
            $("#mute-btn").tooltip('hide')
                .attr('data-original-title', 'Unmute')
                .tooltip('show');
        }
        setAudioEnabled(false);
        muted = true;
    } else {
        if ($(this).hasClass("btn-danger")) {
            $("#mute-btn").removeClass("btn-danger").addClass("btn-primary");
            $("#mute-btn").tooltip('hide')
                .attr('data-original-title', 'Mute')
                .tooltip('show');
        }
        setAudioEnabled(true);
        muted = false;
    }
});


