"""Encoder v2's files (rl:encode --encoder 2), read in Python with numpy only: a sample's arrays, and the pooled vector.

This is the reference reader: pooled() follows packages/bot/src/encoder-v2.ts poolV2 exactly (whole numbers, int64), so
check_encv2.py can compare it with the TypeScript one (check C20). Training reads the same arrays (a faster gather can be
checked against this one).

  enc = EncV2("D:/SVE/rl-runs/stage1-v1/enc-v2")
  s = enc.sample(0)          # glob [159], cards [nc, 103], piles [np, 4], gdef [ng, 25] (the sample's game's rows)
  x = enc.pooled([0, 1, 2])  # int64 [3, 6735]
"""
import json
import os

import numpy as np


class EncV2:
    def __init__(self, folder):
        self.dir = folder
        with open(os.path.join(folder, "meta.json"), encoding="utf8") as f:
            self.meta = json.load(f)
        enc = self.meta["encoder"]
        if enc["version"] != 2 or enc.get("variant") != "fair":
            raise ValueError("not a fair encoder v2 folder")
        self.static = np.load(os.path.join(folder, "static.npy"))
        self.layout = enc["pooled"]["layout"]
        self.masked = np.asarray(enc["pooled"]["masked"], dtype=np.int64)
        self.dims = enc["pooled"]["dims"]
        self.n_static = self.static.shape[1]
        self.n_gdef = len(enc["arrays"]["gdef"]["names"])
        self.n_body = len(enc["arrays"]["card"]["body"])
        self.n_global = len(enc["arrays"]["glob"]["names"])
        self.shards = []
        start = 0
        for s in self.meta["shards"]:
            self.shards.append((s["shard"], start, s["rows"]))
            start += s["rows"]
        self.n = start
        self._arrays = {}

    def _shard(self, shard):
        if shard not in self._arrays:
            name = lambda k: os.path.join(self.dir, "%s-%04d.npy" % (k, shard))
            self._arrays[shard] = {k: np.load(name(k), mmap_mode="r") for k in ("glob", "card", "pile", "off", "gbase", "gdef")}
        return self._arrays[shard]

    def locate(self, i):
        for shard, start, rows in self.shards:
            if start <= i < start + rows:
                return shard, i - start
        raise IndexError(i)

    def sample(self, i):
        shard, r = self.locate(i)
        a = self._shard(shard)
        c0, p0 = a["off"][r]
        c1, p1 = a["off"][r + 1]
        cards = np.asarray(a["card"][c0:c1])
        piles = np.asarray(a["pile"][p0:p1])
        base = int(a["gbase"][r])
        # Python ints: the stored gd is int16, and base + gd can pass 32,767 in a shard.
        top = max([-1] + [int(x) for x in cards[:, 2]] + [int(x) for x in piles[:, 2]])
        gdef = np.asarray(a["gdef"][base : base + top + 1])
        return {"glob": np.asarray(a["glob"][r]), "cards": cards, "piles": piles, "gdef": gdef}

    def pooled(self, indices):
        out = np.zeros((len(indices), self.dims), dtype=np.int64)
        for k, i in enumerate(indices):
            out[k] = self._pooled_one(self.sample(int(i)))
        return out

    def _pooled_one(self, s):
        v = np.zeros(self.dims, dtype=np.int64)
        v[: self.n_global] = s["glob"]
        cards, piles, gdef = s["cards"], s["piles"], s["gdef"]
        at = self.n_global
        for g in self.layout:
            card = g["kind"] == "card"
            width = self.n_static + self.n_gdef + (self.n_body if card else 0)
            rows = cards if card else piles
            sel = rows[np.isin(rows[:, 0], g["zones"])]
            count_at, sum_at = at, at + 1
            max_at = at + 1 + width if "max" in g["parts"] else -1
            at += 1 + width * (len(g["parts"]) - 1)
            if len(sel) == 0:
                continue
            feats = np.concatenate([self.static[sel[:, 1]].astype(np.int64), gdef[sel[:, 2], 2:].astype(np.int64)] + ([sel[:, 3:].astype(np.int64)] if card else []), axis=1)
            mult = np.ones(len(sel), dtype=np.int64) if card else sel[:, 3].astype(np.int64)
            v[count_at] = mult.sum()
            v[sum_at : sum_at + width] = (feats * mult[:, None]).sum(axis=0)
            if max_at >= 0:
                v[max_at : max_at + width] = feats.max(axis=0)
        if s["glob"][0] == 0:
            v[self.masked] = -1
        return v
