var DataStream = require("./DataStream");

class MSGREADER{
  
    // MSG Reader
    constructor (arrayBuffer) {
      this.ds = new DataStream(arrayBuffer, 0, DataStream.LITTLE_ENDIAN);
    }

  // constants
  get CONST(){
    return{
      FILE_HEADER: this.uInt2int([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]),
      MSG: {
        UNUSED_BLOCK: -1,
        END_OF_CHAIN: -2,

        S_BIG_BLOCK_SIZE: 0x0200,
        S_BIG_BLOCK_MARK: 9,

        L_BIG_BLOCK_SIZE: 0x1000,
        L_BIG_BLOCK_MARK: 12,

        SMALL_BLOCK_SIZE: 0x0040,
        BIG_BLOCK_MIN_DOC_SIZE: 0x1000,
        HEADER: {
          PROPERTY_START_OFFSET: 0x30,

          BAT_START_OFFSET: 0x4c,
          BAT_COUNT_OFFSET: 0x2C,

          SBAT_START_OFFSET: 0x3C,
          SBAT_COUNT_OFFSET: 0x40,

          XBAT_START_OFFSET: 0x44,
          XBAT_COUNT_OFFSET: 0x48
        },
        PROP: {
          NO_INDEX: -1,
          PROPERTY_SIZE: 0x0080,

          NAME_SIZE_OFFSET: 0x40,
          MAX_NAME_LENGTH: (/*NAME_SIZE_OFFSET*/0x40 / 2) - 1,
          TYPE_OFFSET: 0x42,
          PREVIOUS_PROPERTY_OFFSET: 0x44,
          NEXT_PROPERTY_OFFSET: 0x48,
          CHILD_PROPERTY_OFFSET: 0x4C,
          START_BLOCK_OFFSET: 0x74,
          SIZE_OFFSET: 0x78,
          TYPE_ENUM: {
            DIRECTORY: 1,
            DOCUMENT: 2,
            ROOT: 5
          }
        },
        FIELD: {
          PREFIX: {
            ATTACHMENT: '__attach_version1.0',
            RECIPIENT: '__recip_version1.0',
            DOCUMENT: '__substg1.'
          },
          // example (use fields as needed)
          NAME_MAPPING: {
            // email specific
            '0037': 'subject',
            '0c1a': 'senderName',
            '5d02': 'senderEmail',
            '1000': 'body',
            // attachment specific
            '3703': 'extension',
            '3704': 'fileNameShort',
            '3707': 'fileName',
            '3712': 'pidContentId',
            // recipient specific
            '3001': 'name',
            '39fe': 'email'
          },
          CLASS_MAPPING: {
            ATTACHMENT_DATA: '3701'
          },
          TYPE_MAPPING: {
            '001e': 'string',
            '001f': 'unicode',
            '0102': 'binary'
          },
          DIR_TYPE: {
            INNER_MSG: '000d'
          }
        }
      }
    }
  };

  // unit utils
  arraysEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a.length != b.length) return false;

    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  uInt2int(data) {
    var result = new Array(data.length);
    for (var i = 0; i < data.length; i++) {
      result[i] = data[i] << 24 >> 24;
    }
    return result;
  }

  // MSG Reader implementation

  // check MSG file header
  isMSGFile(ds) {
    ds.seek(0);
    return this.arraysEqual(this.CONST.FILE_HEADER, ds.readInt8Array(this.CONST.FILE_HEADER.length));
  }

  // FAT utils
  getBlockOffsetAt(msgData, offset) {
    return (offset + 1) * msgData.bigBlockSize;
  }

  getBlockAt(ds, msgData, offset) {
    var startOffset = this.getBlockOffsetAt(msgData, offset);
    ds.seek(startOffset);
    return ds.readInt32Array(msgData.bigBlockLength);
  }

  getNextBlockInner(ds, msgData, offset, blockOffsetData) {
    var currentBlock = Math.floor(offset / msgData.bigBlockLength);
    var currentBlockIndex = offset % msgData.bigBlockLength;

    var startBlockOffset = blockOffsetData[currentBlock];

    return this.getBlockAt(ds, msgData, startBlockOffset)[currentBlockIndex];
  }

  getNextBlock(ds, msgData, offset) {
    return this.getNextBlockInner(ds, msgData, offset, msgData.batData);
  }

  getNextBlockSmall(ds, msgData, offset) {
    return this.getNextBlockInner(ds, msgData, offset, msgData.sbatData);
  }

  // convert binary data to dictionary
  parseMsgData(ds) {
    var msgData = this.headerData(ds);
    msgData.batData = this.batData(ds, msgData);
    msgData.sbatData = this.sbatData(ds, msgData);
    if (msgData.xbatCount > 0) {
      xbatData(ds, msgData);
    }
    msgData.propertyData = this.propertyData(ds, msgData);
    msgData.fieldsData = this.fieldsData(ds, msgData);

    return msgData;
  }

  // extract header data
  headerData(ds) {
    var headerData = {};

    // system data
    headerData.bigBlockSize =
      ds.readByte(/*const position*/30) == this.CONST.MSG.L_BIG_BLOCK_MARK ? this.CONST.MSG.L_BIG_BLOCK_SIZE : this.CONST.MSG.S_BIG_BLOCK_SIZE;
    headerData.bigBlockLength = headerData.bigBlockSize / 4;
    headerData.xBlockLength = headerData.bigBlockLength - 1;

    // header data
    headerData.batCount = ds.readInt(this.CONST.MSG.HEADER.BAT_COUNT_OFFSET);
    headerData.propertyStart = ds.readInt(this.CONST.MSG.HEADER.PROPERTY_START_OFFSET);
    headerData.sbatStart = ds.readInt(this.CONST.MSG.HEADER.SBAT_START_OFFSET);
    headerData.sbatCount = ds.readInt(this.CONST.MSG.HEADER.SBAT_COUNT_OFFSET);
    headerData.xbatStart = ds.readInt(this.CONST.MSG.HEADER.XBAT_START_OFFSET);
    headerData.xbatCount = ds.readInt(this.CONST.MSG.HEADER.XBAT_COUNT_OFFSET);

    return headerData;
  }

  batCountInHeader(msgData) {
    var maxBatsInHeader = (this.CONST.MSG.S_BIG_BLOCK_SIZE - this.CONST.MSG.HEADER.BAT_START_OFFSET) / 4;
    return Math.min(msgData.batCount, maxBatsInHeader);
  }

  batData(ds, msgData) {
    var result = new Array(this.batCountInHeader(msgData));
    ds.seek(this.CONST.MSG.HEADER.BAT_START_OFFSET);
    for (var i = 0; i < result.length; i++) {
      result[i] = ds.readInt32()
    }
    return result;
  }

  sbatData(ds, msgData) {
    var result = [];
    var startIndex = msgData.sbatStart;

    for (var i = 0; i < msgData.sbatCount && startIndex != this.CONST.MSG.END_OF_CHAIN; i++) {
      result.push(startIndex);
      startIndex = this.getNextBlock(ds, msgData, startIndex);
    }
    return result;
  }

  xbatData(ds, msgData) {
    var batCount = this.batCountInHeader(msgData);
    var batCountTotal = msgData.batCount;
    var remainingBlocks = batCountTotal - batCount;

    var nextBlockAt = msgData.xbatStart;
    for (var i = 0; i < msgData.xbatCount; i++) {
      var xBatBlock = getBlockAt(ds, msgData, nextBlockAt);
      nextBlockAt = xBatBlock[msgData.xBlockLength];

      var blocksToProcess = Math.min(remainingBlocks, msgData.xBlockLength);
      for (var j = 0; j < blocksToProcess; j++) {
        var blockStartAt = xBatBlock[j];
        if (blockStartAt == this.CONST.MSG.UNUSED_BLOCK || blockStartAt == this.CONST.MSG.END_OF_CHAIN) {
          break;
        }
        msgData.batData.push(blockStartAt);
      }
      remainingBlocks -= blocksToProcess;
    }
  }

  // extract property data and property hierarchy
  propertyData(ds, msgData) {
    var props = [];

    var currentOffset = msgData.propertyStart;

    while (currentOffset != this.CONST.MSG.END_OF_CHAIN) {
      this.convertBlockToProperties(ds, msgData, currentOffset, props);
      currentOffset = this.getNextBlock(ds, msgData, currentOffset);
    }
    this.createPropertyHierarchy(props, /*property with index 0 (zero) always as root*/props[0]);
    return props;
  }

  convertName(ds, offset) {
    var nameLength = ds.readShort(offset + this.CONST.MSG.PROP.NAME_SIZE_OFFSET);
    if (nameLength < 1) {
      return '';
    } else {
      return ds.readStringAt(offset, nameLength / 2);
    }
  }

  convertProperty(ds, index, offset) {
    return {
      index: index,
      type: ds.readByte(offset + this.CONST.MSG.PROP.TYPE_OFFSET),
      name: this.convertName(ds, offset),
      // hierarchy
      previousProperty: ds.readInt(offset + this.CONST.MSG.PROP.PREVIOUS_PROPERTY_OFFSET),
      nextProperty: ds.readInt(offset + this.CONST.MSG.PROP.NEXT_PROPERTY_OFFSET),
      childProperty: ds.readInt(offset + this.CONST.MSG.PROP.CHILD_PROPERTY_OFFSET),
      // data offset
      startBlock: ds.readInt(offset + this.CONST.MSG.PROP.START_BLOCK_OFFSET),
      sizeBlock: ds.readInt(offset + this.CONST.MSG.PROP.SIZE_OFFSET)
    };
  }

  convertBlockToProperties(ds, msgData, propertyBlockOffset, props) {

    var propertyCount = msgData.bigBlockSize / this.CONST.MSG.PROP.PROPERTY_SIZE;
    var propertyOffset = this.getBlockOffsetAt(msgData, propertyBlockOffset);

    for (var i = 0; i < propertyCount; i++) {
      var propertyType = ds.readByte(propertyOffset + this.CONST.MSG.PROP.TYPE_OFFSET);
      switch (propertyType) {
        case this.CONST.MSG.PROP.TYPE_ENUM.ROOT:
        case this.CONST.MSG.PROP.TYPE_ENUM.DIRECTORY:
        case this.CONST.MSG.PROP.TYPE_ENUM.DOCUMENT:
          props.push(this.convertProperty(ds, props.length, propertyOffset));
          break;
        default:
          /* unknown property types */
          props.push(null);
      }

      propertyOffset += this.CONST.MSG.PROP.PROPERTY_SIZE;
    }
  }

  createPropertyHierarchy(props, nodeProperty) {

    if (nodeProperty.childProperty == this.CONST.MSG.PROP.NO_INDEX) {
      return;
    }
    nodeProperty.children = [];

    var children = [nodeProperty.childProperty];
    while (children.length != 0) {
      var currentIndex = children.shift();
      var current = props[currentIndex];
      if (current == null) {
        continue;
      }
      nodeProperty.children.push(currentIndex);

      if (current.type == this.CONST.MSG.PROP.TYPE_ENUM.DIRECTORY) {
        this.createPropertyHierarchy(props, current);
      }
      if (current.previousProperty != this.CONST.MSG.PROP.NO_INDEX) {
        children.push(current.previousProperty);
      }
      if (current.nextProperty != this.CONST.MSG.PROP.NO_INDEX) {
        children.push(current.nextProperty);
      }
    }
  }

  // extract real fields
  fieldsData(ds, msgData) {
    var fields = {
      attachments: [],
      recipients: []
    };
    this.fieldsDataDir(ds, msgData, msgData.propertyData[0], fields);
    return fields;
  }

  fieldsDataDir(ds, msgData, dirProperty, fields) {

    if (dirProperty.children && dirProperty.children.length > 0) {
      for (var i = 0; i < dirProperty.children.length; i++) {
        var childProperty = msgData.propertyData[dirProperty.children[i]];

        if (childProperty.type == this.CONST.MSG.PROP.TYPE_ENUM.DIRECTORY) {
          this.fieldsDataDirInner(ds, msgData, childProperty, fields)
        } else if (childProperty.type == this.CONST.MSG.PROP.TYPE_ENUM.DOCUMENT
          && childProperty.name.indexOf(this.CONST.MSG.FIELD.PREFIX.DOCUMENT) == 0) {
          this.fieldsDataDocument(ds, msgData, childProperty, fields);
        }
      }
    }
  }

  fieldsDataDirInner(ds, msgData, dirProperty, fields) {
    if (dirProperty.name.indexOf(this.CONST.MSG.FIELD.PREFIX.ATTACHMENT) == 0) {

      // attachment
      var attachmentField = {};
      fields.attachments.push(attachmentField);
      this.fieldsDataDir(ds, msgData, dirProperty, attachmentField);
    } else if (dirProperty.name.indexOf(this.CONST.MSG.FIELD.PREFIX.RECIPIENT) == 0) {

      // recipient
      var recipientField = {};
      fields.recipients.push(recipientField);
      this.fieldsDataDir(ds, msgData, dirProperty, recipientField);
    } else {

      // other dir
      var childFieldType = this.getFieldType(dirProperty);
      if (childFieldType != this.CONST.MSG.FIELD.DIR_TYPE.INNER_MSG) {
        this.fieldsDataDir(ds, msgData, dirProperty, fields);
      } else {
        // MSG as attachment currently isn't supported
        fields.innerMsgContent = true;
      }
    }
  }

  fieldsDataDocument(ds, msgData, documentProperty, fields) {
    var value = documentProperty.name.substring(12).toLowerCase();
    var fieldClass = value.substring(0, 4);
    var fieldType = value.substring(4, 8);

    var fieldName = this.CONST.MSG.FIELD.NAME_MAPPING[fieldClass];

    if (fieldName) {
      fields[fieldName] = this.getFieldValue(ds, msgData, documentProperty, fieldType);
    }
    if (fieldClass == this.CONST.MSG.FIELD.CLASS_MAPPING.ATTACHMENT_DATA) {

      // attachment specific info
      fields['dataId'] = documentProperty.index;
      fields['contentLength'] = documentProperty.sizeBlock;
    }
  }

  getFieldType(fieldProperty) {
    var value = fieldProperty.name.substring(12).toLowerCase();
    return value.substring(4, 8);
  }

  // extractor structure to manage bat/sbat block types and different data types
  get extractorFieldValue(){
    return{
      sbat: {
        'extractor': function extractDataViaSbat(ds, msgData, fieldProperty, dataTypeExtractor) {
          var chain = this.getChainByBlockSmall(ds, msgData, fieldProperty);
          if (chain.length == 1) {
            return this.readDataByBlockSmall(ds, msgData, fieldProperty.startBlock, fieldProperty.sizeBlock, dataTypeExtractor);
          } else if (chain.length > 1) {
            return this.readChainDataByBlockSmall(ds, msgData, fieldProperty, chain, dataTypeExtractor);
          }
          return null;
        }.bind(this),
        dataType: {
          'string': function extractBatString(ds, msgData, blockStartOffset, bigBlockOffset, blockSize) {
            ds.seek(blockStartOffset + bigBlockOffset);
            return ds.readString(blockSize);
          },
          'unicode': function extractBatUnicode(ds, msgData, blockStartOffset, bigBlockOffset, blockSize) {
            ds.seek(blockStartOffset + bigBlockOffset);
            return ds.readUCS2String(blockSize / 2);
          },
          'binary': function extractBatBinary(ds, msgData, blockStartOffset, bigBlockOffset, blockSize) {
            ds.seek(blockStartOffset + bigBlockOffset);
            var toReadLength = Math.min(Math.min(msgData.bigBlockSize - bigBlockOffset, blockSize), this.CONST.MSG.SMALL_BLOCK_SIZE);
            return ds.readUint8Array(toReadLength);
          }.bind(this)
        }
      },
      bat: {
        'extractor': function extractDataViaBat(ds, msgData, fieldProperty, dataTypeExtractor) {
          var offset = this.getBlockOffsetAt(msgData, fieldProperty.startBlock);
          ds.seek(offset);
          return dataTypeExtractor(ds, fieldProperty);
        }.bind(this),
        dataType: {
          'string': function extractSbatString(ds, fieldProperty) {
            return ds.readString(fieldProperty.sizeBlock);
          },
          'unicode': function extractSbatUnicode(ds, fieldProperty) {
            return ds.readUCS2String(fieldProperty.sizeBlock / 2);
          },
          'binary': function extractSbatBinary(ds, fieldProperty) {
            return ds.readUint8Array(fieldProperty.sizeBlock);
          }
        }
      }
  }
  };

  readDataByBlockSmall(ds, msgData, startBlock, blockSize, dataTypeExtractor) {
    var byteOffset = startBlock * this.CONST.MSG.SMALL_BLOCK_SIZE;
    var bigBlockNumber = Math.floor(byteOffset / msgData.bigBlockSize);
    var bigBlockOffset = byteOffset % msgData.bigBlockSize;

    var rootProp = msgData.propertyData[0];

    var nextBlock = rootProp.startBlock;
    for (var i = 0; i < bigBlockNumber; i++) {
      nextBlock = this.getNextBlock(ds, msgData, nextBlock);
    }
    var blockStartOffset = this.getBlockOffsetAt(msgData, nextBlock);

    return dataTypeExtractor(ds, msgData, blockStartOffset, bigBlockOffset, blockSize);
  }

  readChainDataByBlockSmall(ds, msgData, fieldProperty, chain, dataTypeExtractor) {
    var resultData = new Int8Array(fieldProperty.sizeBlock);

    for (var i = 0, idx = 0; i < chain.length; i++) {
      var data = this.readDataByBlockSmall(ds, msgData, chain[i], this.CONST.MSG.SMALL_BLOCK_SIZE, this.extractorFieldValue.sbat.dataType.binary);
      for (var j = 0; j < data.length; j++) {
        resultData[idx++] = data[j];
      }
    }
    var localDs = new DataStream(resultData, 0, DataStream.LITTLE_ENDIAN);
    return dataTypeExtractor(localDs, msgData, 0, 0, fieldProperty.sizeBlock);
  }

  getChainByBlockSmall(ds, msgData, fieldProperty) {
    var blockChain = [];
    var nextBlockSmall = fieldProperty.startBlock;
    while (nextBlockSmall != this.CONST.MSG.END_OF_CHAIN) {
      blockChain.push(nextBlockSmall);
      nextBlockSmall = this.getNextBlockSmall(ds, msgData, nextBlockSmall);
    }
    return blockChain;
  }

  getFieldValue(ds, msgData, fieldProperty, type) {
    var value = null;

    var valueExtractor =
      fieldProperty.sizeBlock < this.CONST.MSG.BIG_BLOCK_MIN_DOC_SIZE ? this.extractorFieldValue.sbat : this.extractorFieldValue.bat;
    var dataTypeExtractor = valueExtractor.dataType[this.CONST.MSG.FIELD.TYPE_MAPPING[type]];

    if (dataTypeExtractor) {
      value = valueExtractor.extractor(ds, msgData, fieldProperty, dataTypeExtractor);
    }
    return value;
  }



    /**
     Converts bytes to fields information

     @return {Object} The fields data for MSG file
     */
    getFileData() {
      if (!this.isMSGFile(this.ds)) {
        return {error: 'Unsupported file type!'};
      }
      if (this.fileData == null) {
        this.fileData = this.parseMsgData(this.ds);
      }
      return this.fileData.fieldsData;
    }
    /**
     Reads an attachment content by key/ID

     @return {Object} The attachment for specific attachment key
     */
    getAttachment(attach) {
      var attachData = typeof attach === 'number' ? this.fileData.fieldsData.attachments[attach] : attach;
      var fieldProperty = this.fileData.propertyData[attachData.dataId];
      var fieldData = this.getFieldValue(this.ds, this.fileData, fieldProperty, this.getFieldType(fieldProperty));

      return {fileName: attachData.fileName, content: fieldData};
    }  

  //window.MSGReader = MSGReader;
}

module.exports = MSGREADER;

