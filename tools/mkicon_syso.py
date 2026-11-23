"""Make a Windows resource object (.syso) holding an application icon, no external tools needed.
Usage: mkicon_syso.py icon.ico out.syso   (Go links *.syso in the package directory automatically)"""
import struct, sys
ico = open(sys.argv[1], 'rb').read()
_, _, n = struct.unpack('<HHH', ico[:6])
imgs = []
for i in range(n):
    w, h, cc, _r, pl, bc, size, off = struct.unpack('<BBBBHHII', ico[6 + 16*i: 22 + 16*i])
    imgs.append((w, h, cc, pl, bc, ico[off:off+size]))
grp = struct.pack('<HHH', 0, 1, n) + b''.join(struct.pack('<BBBBHHIH', w, h, cc, 0, pl, bc, len(d), i+1) for i, (w, h, cc, pl, bc, d) in enumerate(imgs))
# resource tree: root -> {ICON(3), GROUP_ICON(14)} -> id -> lang(0x409) -> data entry
leaves = [(3, i+1, imgs[i][5]) for i in range(n)] + [(14, 1, grp)]
types = {}
for t, i, d in leaves: types.setdefault(t, []).append((i, d))
tl = sorted(types)
# compute layout
off = 16 + 8*len(tl)                       # root dir
type_dir = {}; 
for t in tl: type_dir[t] = off; off += 16 + 8*len(types[t])
id_dir = {}
for t in tl:
    for i, d in types[t]: id_dir[(t, i)] = off; off += 16 + 8
ent = {}
for t in tl:
    for i, d in types[t]: ent[(t, i)] = off; off += 16
data_off = {}
for t in tl:
    for i, d in types[t]: data_off[(t, i)] = off; off += (len(d) + 3) & ~3
buf = bytearray(off); relocs = []
def dirhdr(pos, nid): struct.pack_into('<IIHHHH', buf, pos, 0, 0, 0, 0, 0, nid)
dirhdr(0, len(tl))
for k, t in enumerate(tl): struct.pack_into('<II', buf, 16 + 8*k, t, 0x80000000 | type_dir[t])
for t in tl:
    dirhdr(type_dir[t], len(types[t]))
    for k, (i, d) in enumerate(types[t]):
        struct.pack_into('<II', buf, type_dir[t] + 16 + 8*k, i, 0x80000000 | id_dir[(t, i)])
        dirhdr(id_dir[(t, i)], 1)
        struct.pack_into('<II', buf, id_dir[(t, i)] + 16, 0x409, ent[(t, i)])
        struct.pack_into('<IIII', buf, ent[(t, i)], data_off[(t, i)], len(d), 0, 0)
        relocs.append(ent[(t, i)])
        buf[data_off[(t, i)]: data_off[(t, i)] + len(d)] = d
raw = bytes(buf)
raw_ptr = 20 + 40; reloc_ptr = raw_ptr + len(raw); sym_ptr = reloc_ptr + 10*len(relocs)
out = struct.pack('<HHIIIHH', 0x8664, 1, 0, sym_ptr, 2, 0, 0)
out += struct.pack('<8sIIIIIIHHI', b'.rsrc', 0, 0, len(raw), raw_ptr, reloc_ptr, 0, len(relocs), 0, 0xC0300040)
out += raw + b''.join(struct.pack('<IIH', r, 0, 3) for r in relocs)
sym = struct.pack('<IhHBB', 0, 1, 0, 3, 1)                       # value, section, type, class(static), aux count
sym = b'.rsrc\0\0\0' + sym
aux = struct.pack('<IHHIHBBBB', len(raw), len(relocs), 0, 0, 0, 0, 0, 0, 0)[:18]
out += sym + aux
out += struct.pack('<I', 4)   # empty string table
open(sys.argv[2], 'wb').write(out); print('wrote', sys.argv[2], len(out), 'bytes,', n, 'icons')
