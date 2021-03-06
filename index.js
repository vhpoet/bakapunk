var fs = require("fs");
var spawn = require('child_process').spawn;
var loki = require("lokijs");
var readline = require("readline");
var columnify = require("columnify");
require("colors");

// Music directory
var MUSIC_DIR = fs.readFileSync("music_dir.txt", {encoding: "utf8"});

// Distance metric based on key (ignoring minor/major)
var keyDist = function(a, b) {
  // Convert to radians
  a = a * Math.PI / 6;
  b = b * Math.PI / 6;
  return Math.sqrt(Math.pow(Math.cos(a) - Math.cos(b), 2) + Math.pow(Math.sin(a) - Math.sin(b), 2));
};

// Functional for key distance (ignoring minor/major)
var keyFilt = function(song) {
  var key = Number(song.key.replace("m", ""));
  var fn = function(obj) {
    // If no key, add 2
    if (!obj.key) {
      obj.dist += 1;
    } else {
      var oKey = Number(obj.key.replace("m", ""));
      obj.dist += keyDist(key, oKey);
    }
    return;
  };
  return fn;
};

var muslySearch = function(song, collection, callback) {
  var NUM_SONGS = 150;
  var data = "";
  var child = spawn('musly', ['-k', NUM_SONGS, '-p', MUSIC_DIR + '/' + song.id]);
  // Error handling
  child.stderr.on('data', function(err) {
    console.log(err.toString('utf-8'));
  });
  // Collect data
  child.stdout.on('data', function(chunk) {
    data += chunk.toString('utf-8');
  });
  // Close connection
  child.on('close', function() {
    // Extract 50 songs
    data = data.split("\n");
    data = data.slice(data.length - (NUM_SONGS + 1), -1);
    // Create list of IDs
    var songIDs = [];
    for (var i = 0; i < data.length; i++) {
      songIDs.push(data[i].replace(MUSIC_DIR + '/', ''));
    }
    // Create ResultSet
    var results = collection.chain().find({id: {$in: songIDs}}).copy();
    callback(song, results);
  });
};

var printSongs = function(song, songs) {
  var printArray = [];
  var bpmColor = "";
  for (var i = 0; i < songs.length; i++) {
    if (songs[i].bpm > song.bpm) {
      bpmColor = "green";
    } else if (songs[i].bpm < song.bpm) {
      bpmColor = "red";
    } else {
      bpmColor = "grey";
    }
    // Do not print out if no title
    if (songs[i].title) {
      var defBpm = songs[i].bpm || "?";
      defBpm = defBpm.toString();
      var defKey = songs[i].key || "?";
      printArray.push({
        no: songs.length - i,
        bpm: defBpm[bpmColor],
        key: defKey.cyan,
        artist: songs[i].artist.blue,
        title: songs[i].title.blue
      });
    }
  }
  console.log(columnify(printArray, {columnSplitter: " | "}));
};

// Find similar songs
var findSongs = function(song, collection) {
  // Search musly
  muslySearch(song, collection, function(song, results) {
    // Add distance metric based on BPM
    results.update(function(obj) {obj.dist = Math.abs(song.bpm - obj.bpm);return;});
    // Add distance metric based on key
    var filtFn = keyFilt(song);
    results.update(filtFn);
    // Sort by distance (descending) and return results
    var songs = results.simplesort("dist", true).data();
    // Display results
    printSongs(song, songs);
  });
  // First create a ResultSet filtered by BPM
  //var results = collection.chain().find({bpm: {$gte: song.bpm - 5}}).find({bpm: {$lte: song.bpm + 5}}).copy();
};

// Create readline interface
var rl = readline.createInterface({input: process.stdin, output: process.stdout});

var db = new loki("db.json");
// Load existing database
db.loadDatabase({}, function() {
  // Get music collection
  var music = db.getCollection("music");

  // Query song (partial match and case insensitive)
  rl.question("Partial search for song title: ", function(ans) {
    ans = ans.trim();
    rl.pause();
    var songs = music.find({title: {$regex: new RegExp(ans, "ig")}});
    // Close if no matches found
    if (songs.length === 0) {
      rl.close();
      return console.log("No matches found. Cancelled.");
    }
    for (var i = 0; i < songs.length; i++) {
      console.log("[" + i + "]", songs[i].artist.blue, "-", songs[i].title.blue);
    }
    // Confirm song
    rl.resume();
    rl.question("Confirm song index (or c to cancel): ", function(ans) {
      ans = ans.trim();
      rl.close();
      if (ans === "c") {
        return console.log("Cancelled.");
      }
      ans = Number(ans);
      if (isNaN(ans) || ans < 0 || ans >= songs.length) {
        return console.log("Invalid index. Cancelled.");
      } else {
        // Search for similar songs
        console.log("Searching similar songs...");
        findSongs(songs[ans], music);
      }
    });
  });
});
