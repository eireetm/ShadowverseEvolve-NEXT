"""Check C20 in Python: the pooled vectors of the fixed samples (pooled-check-idx.npy) recomputed from the arrays by the
reference reader (encv2.py) against the ones the TypeScript encoder computed (pooled-check.npy). Prints one line, in Chinese.

  py -3.14 -I tools/rl/py/check_encv2.py <enc-v2 folder>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# No __pycache__ next to the repository's sources.
sys.dont_write_bytecode = True
import numpy as np  # noqa: E402

from encv2 import EncV2  # noqa: E402


def main(folder):
    # The caller reads UTF-8 (a Windows console would otherwise encode the Chinese line with its code page).
    sys.stdout.reconfigure(encoding="utf-8")
    enc = EncV2(folder)
    idx = np.load(os.path.join(folder, "pooled-check-idx.npy"))
    ts = np.load(os.path.join(folder, "pooled-check.npy")).astype(np.int64)
    py = enc.pooled(idx)
    bad = int((py != ts).sum())
    print("numpy %s 读回 %d 个固定样本、%d 个值，和 TypeScript 的汇总向量不同的 %d 个" % (np.__version__, len(idx), py.size, bad))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
