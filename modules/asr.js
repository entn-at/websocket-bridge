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

require('dotenv').config({ path: 'env.txt' });

const defaultRate = 16000;
const languageCode = 'en-US';

// Because of a quirk in proto-loader, we use static code gen to get the AudioEncoding enum,
// and dynamic loading for the rest.
const jAudio = require('./protos/src/jarvis_proto/audio_pb');

const { Transform } = require('stream');

var asrProto = 'src/jarvis_proto/jarvis_asr.proto';
var protoRoot = __dirname + '/protos/';
var grpc = require('grpc');
var protoLoader = require('@grpc/proto-loader');
const { request } = require('express');
var protoOptions = {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [protoRoot]
};
var asrPkgDef = protoLoader.loadSync(asrProto, protoOptions);

var jAsr = grpc.loadPackageDefinition(asrPkgDef).nvidia.jarvis.asr;

class ASRPipe {
    setupASR(config_data) {
        // the Jarvis ASR client
        this.asrClient = new jAsr.JarvisASR(process.env.JARVIS_API_URL, grpc.credentials.createInsecure());
        this.firstRequest = {
            streaming_config: {
                config: {
                    encoding: jAudio.AudioEncoding.LINEAR_PCM,
                    sample_rate_hertz: config_data.sampleRateHz,
                    language_code: config_data.language,
                    max_alternatives: 1,
                    enable_automatic_punctuation: true
                },
                interim_results: true
            }
        };
        this.numCharsPrinted = 0;
    }

    async mainASR(transcription_cb) {
        this.recognizeStream = this.asrClient.streamingRecognize()
            .on('data', function (data) {
                if (data.results == undefined || data.results[0] == undefined) {
                    return;
                }

                // callback sends the transcription results back through the bidirectional socket stream
                transcription_cb({
                    transcript: data.results[0].alternatives[0].transcript,
                    is_final: data.results[0].is_final
                });
            })
            .on('error', (error) => {
                console.log('Error via streamingRecognize callback');
                console.log(error);
            })
            .on('end', () => {
                console.log('StreamingRecognize end');
            });

        this.recognizeStream.write(this.firstRequest);
    }
}

module.exports = ASRPipe;