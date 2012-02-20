(function () {
  "use strict";

  var EventEmitter = require('events').EventEmitter
    , $ = require('ender')
    , fadeVolume = require('./volume-fader')
    ;

  function pad(s) {
    s = s.toString();
    while (s.length < 2) {
      s = "0" + s;
    }
    return s;
  }

  function toTime(floatSecs) {
    return Math.floor(floatSecs / 60) + ':' + pad(Math.round(floatSecs % 59) );
  }

  function create(selector) {
    selector += ' ';

    var emitter = new EventEmitter()
      , playerEl = $(selector)
      , selectors = {
            "play": '.mb-play'
          , "pause": '.mb-pause'
          , "louder": '.mb-vol-up'
          , "quieter": '.mb-vol-down' 
          , "mute": '.mb-vol-mute'
          , "next": '.mb-next'
          , "previous": '.mb-previous'
          , "forward": '.mb-pos-forward'
          , "back": '.mb-pos-back'
          , "tracklist": selector + '.mb-audios'
          , "playtimeTotal": selector + '.mb-playtime-total'
          , "playtimePassed": selector + '.mb-playtime-passed'
          , "playtime": selector + '.mb-playtime'
          , "progress": selector + 'progress'
          , "duration": selector + '.duration'
        }
      , defaultVolume = 1
      , preMuteVolume = 0.1
      , currentTrackMeta
      , currentTrack
      , nextTrack
      , nextTrackMeta
      , fadeTimeout
      ;

    function getTracks() {
      var arr = []
        ;

      if (currentTrack) {
        arr.push(currentTrack);
      }

      if (nextTrack) {
        arr.push(nextTrack);
      }

      return arr;
    }

    function updateDuration(ev) {
      $(selectors.duration).text(toTime(this.duration));
    }

    function updateTime(ev) {
      $(selectors.progress).attr('max', this.duration);
      $(selectors.progress).attr('value', this.currentTime);

      $(selectors.playtimeTotal).text(toTime(this.duration));
      $(selectors.playtimePassed).text(toTime(this.duration - this.currentTime));
      $(selectors.playtime).text(toTime(this.currentTime));
    }

    function enqueTrack(track) {
      nextTrack = track.audio = track.audio || $("<audio src='" + track.href + "'></audio>")[0];
      nextTrackMeta = track;
      if (!currentTrack) {
        addTrack();
      }
    }

    function skipToTrack(track) {
      enqueTrack(track);
      cleanupTrack();
    }

    function crossFadeTrack() {
      if (!nextTrack) {
        return;
      }

      // TODO fade
      // nextTrack.volume = 0.1;
      nextTrack.play();
    }
    // in contrast to cross-fade, which should begin the play
    function cleanupTrack() {
      addTrack();
    }

    function addTrack() {
      if (!nextTrack) {
        return;
      }
      removeTrack(true);

      currentTrack = nextTrack;
      currentTrackMeta = nextTrackMeta;
      nextTrack = undefined;
      nextTrackMeta = undefined;
      emitter.emit('next', enqueTrack);

      currentTrack.addEventListener('durationchange', updateDuration);
      currentTrack.addEventListener('timeupdate', updateTime);
      currentTrack.addEventListener('ended', cleanupTrack);

      // BUG XXX don't do this, duh
      global.testPlayerAudio = currentTrack;
      $(selectors.tracklist).append(currentTrack);
      $(selectors.play).show();

      playNow();
      currentTrack.volume = preMuteVolume;
    }

    function removeTrack(calledByAdd) {
      if (!currentTrack) {
        return;
      }

      // TODO add to play history
      currentTrack.removeEventListener('durationchange', updateDuration);
      currentTrack.removeEventListener('timeupdate', updateTime);
      currentTrack.removeEventListener('ended', cleanupTrack);
      currentTrack.remove();

      // TODO send data about how long it was played / if it was skipped
      emitter.emit('end', { track: currentTrackMeta });

      if (!calledByAdd) {
        addTrack();
      }
    }

    function resumeTrack(track) {
      if (track.mbWasAlreadyPaused) {
        track.mbWasAlreadyPaused = false;
        return;
      }
      // chrome has a bug where every resume from pause
      // results in an audio glitch sometime during the first 1000ms
      // this is a lousy hack to fix that
      if (track.currentTime > 1.5) {
        track.currentTime -= 1.5;
      // throws DOM exception if 0 is set to 0 (or perhaps just if play() hasn't happened yet)
      } else if (track.currentTime) {
        track.currentTime = 0;
      }
      track.volume = 0;
      track.play();
      setTimeout(function () {
        fadeVolume(null, track, track.mbPreviousPauseVolume || defaultVolume, 300);
      }, 750);
    }

    // play
    function playNow(ev) {
      // TODO update times independently during crossfade
      // and let duration be the duration of the next song
      // I.E.
      // 0:03    3:46    -0:03
      getTracks().forEach(resumeTrack);

      // these need to change after the resume / pause timeout is cancelled
      // in case of doubleclick
      $(selector + ' ' + selectors.pause).show();
      $(selector + ' ' + selectors.play).hide();
      updateTime.apply(currentTrack);
    }
      
    function pauseNow(ev) {
      getTracks().forEach(function (track) {
        function pause() {
          track.pause();
          track.muted = false;
        }
        if (track.paused) {
          track.mbWasAlreadyPaused = true;
        }
        if (track.muted) {
          track.mbPreviousPauseVolume = track.mbPreviousMuteVolume;
        }
        track.mbPreviousPauseVolume = track.volume;
        fadeVolume(pause, track, 0, 300);
      });

      // fadeVolume uses a timeout, these should not
      // be able to change until that has been registered
      $(selector + ' ' + selectors.play).show();
      $(selector + ' ' + selectors.pause).hide();

      updateTime.apply(currentTrack);
    }

    function toggleMute(track) {
      function mute() {
        track.muted = true;
      }
      if (track.muted) {
        track.volume = preMuteVolume;
        track.muted = false;
        fadeVolume(null, track, track.mbPreviousMuteVolume || defaultVolume, 150);
      } else {
        if (track.paused) {
          // TODO needs UI cue
          return;
        }
        track.mbPreviousMuteVolume = Math.max(track.volume, preMuteVolume + 0.01);
        fadeVolume(mute, track, preMuteVolume, 150);
      }
    }

    function muteTracks(ev) {
      // handles the mute-during-crossfade case
      getTracks().forEach(toggleMute);
    }

    function attachHandlers() {
      // TODO fadeout on play, pause, next, and back

      // play
      $(selector).delegate(selectors.play, 'click', playNow);

      // pause
      $(selector).delegate(selectors.pause, 'click', pauseNow);

      // quieter
      $(selector).delegate(selectors.quieter, 'click', function (ev) {
        if (currentTrack.volume > 0) {
          currentTrack.volume -= 0.1;
        }
      });

      // louder
      $(selector).delegate(selectors.louder, 'click', function (ev) {
        if (currentTrack.volume < 1) {
          currentTrack.volume += 0.1;
        }
      });

      // forward
      $(selector).delegate(selectors.forward, 'click', function (ev) {
        if (currentTrack.currentTime < currentTrack.duration) {
          currentTrack.currentTime += 5;
        }
      });

      // back
      $(selector).delegate(selectors.back, 'click', function (ev) {
        if (currentTrack.currentTime > 0) {
          currentTrack.currentTime -= 5;
        }
      });

      // mute
      $(selector).delegate(selectors.mute, 'click', muteTracks);

      $(selectors.play).show();
      $(selectors.pause).hide();
    }

    $.domReady(attachHandlers);

    // add should add item to the list and start playing if nothing better to do
    // play should move item to top of list and crossfade current song
    // insert(<pos>) should add at position <pos> or last if omitted
    emitter.enque = enqueTrack;
    emitter.play = skipToTrack;
    return emitter;
  }

  module.exports.create = create;
}());