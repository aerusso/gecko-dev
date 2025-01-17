# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

from __future__ import absolute_import, print_function, unicode_literals


"""
Run a python script, adding extra directories to the python path.
"""


def main(args):
    def usage():
        print("pythonpath.py -I directory script.py [args...]", file=sys.stderr)
        sys.exit(150)

    paths = []

    while True:
        try:
            arg = args[0]
        except IndexError:
            usage()

        if arg == '-I':
            args.pop(0)
            try:
                path = args.pop(0)
            except IndexError:
                usage()

            paths.append(os.path.abspath(path))
            continue

        if arg.startswith('-I'):
            paths.append(os.path.abspath(args.pop(0)[2:]))
            continue

        break

    script = args[0]

    sys.path[0:0] = [os.path.abspath(os.path.dirname(script))] + paths
    sys.argv = args
    sys.argc = len(args)

    frozenglobals['__name__'] = '__main__'
    frozenglobals['__file__'] = script

    exec(open(script, encoding='utf-8').read(), frozenglobals)


# Freeze scope here ... why this makes things work I have no idea ...
frozenglobals = globals()

import os
import sys

if __name__ == '__main__':
    main(sys.argv[1:])
