import simplemma
import sys
arr = sys.argv[1].split(',')
arr = [t.split(':') for t in arr]
print([(simplemma.lemmatize(t[0], lang='ru') + ":" + t[1]).encode() for t in arr])