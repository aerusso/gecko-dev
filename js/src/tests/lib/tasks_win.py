# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/. */
from __future__ import print_function, unicode_literals, division

import subprocess

from datetime import datetime, timedelta
from mozbuild.util import system_encoding
from threading import Thread
from six.moves.queue import Queue, Empty

from .progressbar import ProgressBar
from .results import NullTestOutput, TestOutput, escape_cmdline


class EndMarker:
    pass


class TaskFinishedMarker:
    pass


def _do_work(qTasks, qResults, qWatch, prefix, run_skipped, timeout, show_cmd):
    while True:
        test = qTasks.get()
        if test is EndMarker:
            qWatch.put(EndMarker)
            qResults.put(EndMarker)
            return

        if not test.enable and not run_skipped:
            qResults.put(NullTestOutput(test))
            continue

        # Spawn the test task.
        cmd = test.get_command(prefix)
        if show_cmd:
            print(escape_cmdline(cmd))
        tStart = datetime.now()
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # Push the task to the watchdog -- it will kill the task
        # if it goes over the timeout while we keep its stdout
        # buffer clear on the "main" worker thread.
        qWatch.put(proc)
        out, err = proc.communicate()
        # We're not setting universal_newlines=True in subprocess.Popen due to
        # still needing to support Python 3.5, which doesn't have the "encoding"
        # parameter to the Popen constructor, so we have to decode the output
        # here.
        out = out.decode(system_encoding)
        err = err.decode(system_encoding)
        qWatch.put(TaskFinishedMarker)

        # Create a result record and forward to result processing.
        dt = datetime.now() - tStart
        result = TestOutput(test, cmd, out, err, proc.returncode, dt.total_seconds(),
                            dt > timedelta(seconds=timeout))
        qResults.put(result)


def _do_watch(qWatch, timeout):
    while True:
        proc = qWatch.get(True)
        if proc == EndMarker:
            return
        try:
            fin = qWatch.get(block=True, timeout=timeout)
            assert fin is TaskFinishedMarker, "invalid finish marker"
        except Empty:
            # Timed out, force-kill the test.
            try:
                proc.terminate()
            except WindowsError as ex:
                # If the process finishes after we time out but before we
                # terminate, the terminate call will fail. We can safely
                # ignore this.
                if ex.winerror != 5:
                    raise
            fin = qWatch.get()
            assert fin is TaskFinishedMarker, "invalid finish marker"


def run_all_tests(tests, prefix, pb, options):
    """
    Uses scatter-gather to a thread-pool to manage children.
    """
    qTasks, qResults = Queue(), Queue()

    workers = []
    watchdogs = []
    for _ in range(options.worker_count):
        qWatch = Queue()
        watcher = Thread(target=_do_watch, args=(qWatch, options.timeout))
        watcher.setDaemon(True)
        watcher.start()
        watchdogs.append(watcher)
        worker = Thread(target=_do_work, args=(qTasks, qResults, qWatch,
                                               prefix, options.run_skipped,
                                               options.timeout, options.show_cmd))
        worker.setDaemon(True)
        worker.start()
        workers.append(worker)

    # Insert all jobs into the queue, followed by the queue-end
    # marker, one per worker. This will not block on growing the
    # queue, only on waiting for more items in the generator. The
    # workers are already started, however, so this will process as
    # fast as we can produce tests from the filesystem.
    def _do_push(num_workers, qTasks):
        for test in tests:
            qTasks.put(test)
        for _ in range(num_workers):
            qTasks.put(EndMarker)
    pusher = Thread(target=_do_push, args=(len(workers), qTasks))
    pusher.setDaemon(True)
    pusher.start()

    # Read from the results.
    ended = 0
    delay = ProgressBar.update_granularity().total_seconds()
    while ended < len(workers):
        try:
            result = qResults.get(block=True, timeout=delay)
            if result is EndMarker:
                ended += 1
            else:
                yield result
        except Empty:
            pb.poke()

    # Cleanup and exit.
    pusher.join()
    for worker in workers:
        worker.join()
    for watcher in watchdogs:
        watcher.join()
    assert qTasks.empty(), "Send queue not drained"
    assert qResults.empty(), "Result queue not drained"
