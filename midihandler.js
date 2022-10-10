let midi = null;
document.getElementById('outputArea').value = '';

let synth = new Tone.Synth({
    oscillator: {
    type: 'square'
    }
    ,
    envelope: {
    attack: 0,
    decay: 0,
    sustain: 1,
    release: 0.001
    }
}
).toMaster();

synth.volume.value = -25;

document.getElementById("inputfile").addEventListener("change", e => {
    const files = e.target.files;
    if (files.length > 0) {
    const file = files[0];
    const reader = new FileReader();
    reader.onload = function (e) {
        midi = new Midi(e.target.result);
        if (!midi) {
        alert("Invalid file provided.");
        return;
        }
        generateTrackInfo(midi);
    };
    reader.readAsArrayBuffer(file);
    }
});

function playNote(frequency, duration) {
    // Simulate a startup time of 5ms
    return (time) => { synth.triggerAttackRelease(frequency, duration - 5 / 1000, time) };
}
let playbackStarted = false;
function togglePreview() {
    // error handling
    if (document.getElementById("outputArea").value == '') {
        SnackBar({
            message: "No MIDI to play! Upload one first, and generate!",
            status: "danger",
            timeout: 1000,
        })
        console.log("M-M300 || Error 3: No notes to play!")
        return
    }


// Playback checking code, toggle just kinda felt tacky and weird...
    if (playbackStarted == false) {
        // start tone playing from queue
        Tone.Transport.start();
        playbackStarted = true;
        document.getElementById("previewStart").textContent = "Stop Preview"
        return "Started Playback";
    }
    if (playbackStarted == true) {
        Tone.Transport.stop();
        playbackStarted = false;
        document.getElementById("previewStart").textContent = "Play Preview"
        return "Stopped Playback";
    }
}

function revertPlay() {
    Tone.Transport.stop();
    playbackStarted = false;
    document.getElementById("previewStart").textContent = "Play Preview"
    return "Successfully reverted PlayState.";
}

function stopPreview() {
    Tone.Transport.stop();
    revertPlay()
}

function generateTrackInfo(midi) {
    let infoDiv = document.getElementById("trackInfo");
    infoDiv.innerHTML = '';
    const trackSelectors = midi.tracks.forEach((track, index) => {
    infoDiv.innerHTML += `<input class="track-btn" id="trackButton${index}" type="checkbox" value=${index}> <p>Track ${index +
        1}: ${track.instrument.name} - ${track.notes.length} notes</p><br>`;
    });
    revertPlay()
}

// From https://gist.github.com/YuxiUx/ef84328d95b10d0fcbf537de77b936cd
function noteToFreq(note) {
    let a = 440; //"A" Frequency, changing this will change the pitch for all notes!
    return (a / 32) * 2 ** ((note - 9) / 12);
}

function handleMidi() {
    const useG4 = document.getElementById("g4toggle").checked;

    // Clear previous scheduled tones
    Tone.Transport.stop();
    Tone.Transport.cancel();

    if (!midi) {
    let error = SnackBar({
        message: "Couldn't Find MIDI File!",
        status: "danger",
        timeout: 5000,
    })
    console.log("M-M300 || Error 1: Couldn't find MIDI file!!")
    return;
    }

    const track = { notes: [] };

    // Merge note arrays from selected tracks
    for (let i = 0; i < midi.tracks.length; i++) {
    if (document.getElementById(`trackButton${i}`).checked) {
        let currTrack = midi.tracks[i].notes;
        // If percussion, add a percussion flag to note
        if (midi.tracks[i].instrument.percussion) {
        currTrack.forEach((note) => {
            note.percussion = true;
        });
        }
        track.notes = track.notes.concat(currTrack);
    }
    }

    // Sort notes by start time
    track.notes.sort((a, b) => a.time - b.time);

    const tempoMultiplier =
    1 /
    Math.max(document.getElementById("speedMultiplierInput").value, 0.01);

    let curr = 0;
    const gcode = [];
    while (curr < track.notes.length) {
    // Keep the highest non-percussion note if multiple occur at the same time
    let highestCurrNote = track.notes[curr].percussion ? -1 : track.notes[curr].midi;
    let duration = track.notes[curr].duration;
    while (
        curr + 1 < track.notes.length &&
        track.notes[curr].time === track.notes[curr + 1].time
    ) {
        curr++;
        if (track.notes[curr].midi > highestCurrNote && !track.notes[curr].percussion) {
        duration = track.notes[curr].duration;
        }

        highestCurrNote = track.notes[curr].percussion ? highestCurrNote : Math.max(highestCurrNote, track.notes[curr].midi);
    }

    // Default to 20ms, 100hz note to simulate percussion
    const frequency = highestCurrNote === -1 ? 100 : noteToFreq(highestCurrNote);
    duration = highestCurrNote === -1 ? 20 / 1000 : duration;

    const time = track.notes[curr].time;
    const nextNoteTime =
        curr + 1 < track.notes.length
        ? track.notes[curr + 1].time
        : duration + time;

    // If this note overlaps the next note, cut the current note off
    let trimmedDuration = Math.min(nextNoteTime - time, duration);

    const pauseDuration = nextNoteTime - time - trimmedDuration;

    // Marlin doesn't seem to deal with very short pauses accurately, so merge short pauses with the previous note.
    // May need tuning
    const minDuration = 20 / 1000;

    if (pauseDuration < minDuration) {
        trimmedDuration += pauseDuration;
    }
    // Write an M300 to play a note with the calculated pitch and duration
    gcode.push(
        `M300 P${Math.round(
        trimmedDuration * 1000 * tempoMultiplier
        )} S${Math.round(frequency)}\n`
    );

    // Duet firmware needs G4 pauses between notes
    if (useG4) {
        gcode.push(
        `G4 P${Math.round(
            trimmedDuration * 1000 * tempoMultiplier
        )}\n`
        );
    }

    // Schedule note to be played in song preview
    Tone.Transport.schedule(playNote(frequency, trimmedDuration * tempoMultiplier), time * tempoMultiplier);

    // If the current note is released before the start of the next note, insert a pause
    if (pauseDuration >= minDuration) {
        gcode.push(
        `M300 P${Math.round(pauseDuration * tempoMultiplier * 1000)} S0\n`
        );
        if (useG4) {
        gcode.push(
            `G4 P${Math.round(pauseDuration * tempoMultiplier * 1000)}\n`
        );
        }
    }

    curr++;
    }
    gcode.push("; GCODE produced by MIDI-M300!")
    const output = gcode.reduce((acc, e) => acc + e, "");
    document.getElementById("outputArea").value = output;
    revertPlay()
}

function saveOutput() {
    let output = document.getElementById("outputArea").value;
    let fileName = document.getElementById("fileName").value;
    if (output.length <= 0) {
        let error = SnackBar({
            message: "Output returned null! Generate GCODE before saving!",
            status: "danger",
            timeout: 5000,
        })
        console.log('M-M300 || Error 2: document.getElementById("outputArea".value) returned null!')
        return
    }
    if (fileName.length <= 0) {
        fileName = document.getElementById("inputfile").files[0].name;
    }
    try {
        let isFileSaverSupported = !!new Blob;
        console.log("Saving...")
    } catch (e) {
        alert("FileSaver.js is not supported!! Update to a newer browser to be able to save your download")
        return
    }
    let blob = new Blob([output], {type: "text/plain;charset=utf-8"})
    saveAs(blob, fileName + ".gcode");
}
let toggled = false;
function toggleInst() {
    if (toggled == false) {
        toggled = true;
        midi.tracks.forEach((track, index) => {  
            document.getElementById(`trackButton${index}`).checked = true
        })
        return;
    } else if (toggled == true) {
        toggled = false;
        midi.tracks.forEach((track, index) => {  
            document.getElementById(`trackButton${index}`).checked = false
        })
        return
    }

}